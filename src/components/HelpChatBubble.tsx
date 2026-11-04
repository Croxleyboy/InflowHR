import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useFeatures } from '../context/FeatureContext'
import { useLanguage } from '../context/LanguageContext'
import { useTheme } from '../context/ThemeContext'
import { formatCurrency, formatDateFriendly as formatDate, getFYRange } from '../lib/formatters'

const ASSISTANT_NAME = 'Employee Help'

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
  askAiQuery?: string
  sourcePolicy?: string
}

const CATEGORIES = [
  { key: 'leave', label: 'Leave', icon: '🏖️' },
  { key: 'pay', label: 'Pay', icon: '💷' },
  { key: 'shifts', label: 'Shifts', icon: '📅' },
  { key: 'timesheets', label: 'Timesheets', icon: '⏱️' },
  { key: 'benefits', label: 'Benefits', icon: '🎁' },
  { key: 'rooms', label: 'Room Booking', icon: '🏢' },
  { key: 'elearning', label: 'Training', icon: '📚' },
  { key: 'kudos', label: 'Kudos', icon: '⭐' },
  { key: 'meetings', label: '1:1 Meetings', icon: '🤝' },
  { key: 'performance', label: 'Performance', icon: '📊' },
  { key: 'onboarding', label: 'Onboarding', icon: '🚀' },
  { key: 'policies', label: 'Policies', icon: '📋' },
  { key: 'general', label: 'General', icon: '❓' },
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

const SYNONYMS: Record<string, string[]> = {
  pet: ['animal', 'dog', 'cat', 'pets', 'animals', 'companion'],
  animal: ['pet', 'dog', 'cat', 'pets', 'animals'],
  dog: ['pet', 'animal', 'pets'],
  cat: ['pet', 'animal', 'pets'],
  holiday: ['leave', 'annual', 'vacation', 'time off', 'day off', 'holidays', 'pto'],
  vacation: ['leave', 'annual', 'holiday', 'time off', 'pto'],
  pto: ['leave', 'annual', 'holiday', 'vacation', 'time off'],
  sick: ['illness', 'unwell', 'medical', 'doctor', 'sickness'],
  illness: ['sick', 'unwell', 'medical', 'sickness'],
  pay: ['salary', 'wage', 'payslip', 'payroll', 'compensation', 'earnings'],
  salary: ['pay', 'wage', 'payslip', 'payroll', 'compensation', 'earnings'],
  wage: ['pay', 'salary', 'payslip', 'payroll', 'earnings'],
  payslip: ['pay', 'salary', 'wage', 'payroll', 'earnings'],
  pregnant: ['pregnancy', 'maternity', 'baby', 'expecting'],
  pregnancy: ['pregnant', 'maternity', 'baby', 'expecting'],
  maternity: ['pregnant', 'pregnancy', 'baby', 'parental', 'paternity'],
  paternity: ['parental', 'maternity', 'baby', 'father'],
  baby: ['maternity', 'paternity', 'parental', 'pregnant', 'pregnancy'],
  parental: ['maternity', 'paternity', 'baby', 'adoption'],
  bereavement: ['death', 'funeral', 'compassionate', 'loss', 'grief', 'deceased'],
  death: ['bereavement', 'funeral', 'compassionate', 'loss', 'grief'],
  funeral: ['bereavement', 'death', 'compassionate'],
  compassionate: ['bereavement', 'death', 'funeral', 'loss'],
  wfh: ['remote', 'home', 'hybrid', 'working from home'],
  remote: ['wfh', 'home', 'hybrid', 'working from home'],
  home: ['wfh', 'remote', 'hybrid'],
  hybrid: ['wfh', 'remote', 'home', 'flexible'],
  flexible: ['hybrid', 'flexitime', 'flex', 'hours'],
  overtime: ['extra hours', 'toil', 'time off in lieu', 'additional hours'],
  toil: ['overtime', 'time off in lieu', 'extra hours', 'lieu'],
  lieu: ['toil', 'overtime', 'time off in lieu'],
  expense: ['expenses', 'receipt', 'claim', 'reimburse', 'reimbursement', 'mileage'],
  expenses: ['expense', 'receipt', 'claim', 'reimburse', 'reimbursement', 'mileage'],
  receipt: ['expense', 'expenses', 'claim', 'reimbursement'],
  mileage: ['expense', 'expenses', 'travel', 'car'],
  pension: ['retirement', 'auto enrolment', 'contribution', 'workplace pension'],
  retirement: ['pension', 'auto enrolment'],
  training: ['elearning', 'course', 'learning', 'development', 'cpd'],
  elearning: ['training', 'course', 'learning', 'development'],
  course: ['training', 'elearning', 'learning'],
  probation: ['trial period', 'probationary', 'new starter'],
  notice: ['resignation', 'resign', 'leaving', 'notice period', 'quit'],
  resign: ['resignation', 'notice', 'leaving', 'quit'],
  resignation: ['resign', 'notice', 'leaving', 'quit'],
  quit: ['resign', 'resignation', 'notice', 'leaving'],
  grievance: ['complaint', 'dispute', 'raise issue', 'formal complaint'],
  complaint: ['grievance', 'dispute', 'raise issue'],
  disciplinary: ['misconduct', 'warning', 'investigation', 'dismissal'],
  bully: ['bullying', 'harassment', 'intimidation'],
  bullying: ['bully', 'harassment', 'intimidation'],
  harassment: ['bullying', 'bully', 'intimidation', 'discrimination'],
  discrimination: ['harassment', 'equality', 'protected characteristic'],
  dress: ['dress code', 'uniform', 'clothing', 'appearance'],
  uniform: ['dress', 'dress code', 'clothing'],
  parking: ['car park', 'car', 'vehicle'],
  smoke: ['smoking', 'vaping', 'cigarette'],
  smoking: ['smoke', 'vaping', 'cigarette'],
  shift: ['rota', 'schedule', 'roster', 'shifts'],
  rota: ['shift', 'schedule', 'roster', 'shifts'],
  swap: ['shift swap', 'exchange', 'trade shift'],
  timesheet: ['hours', 'time tracking', 'clock in', 'time entry'],
  clock: ['clock in', 'clock out', 'check in', 'timesheet'],
  bonus: ['incentive', 'commission', 'performance pay'],
  raise: ['pay rise', 'salary increase', 'pay review', 'increment'],
  promotion: ['promoted', 'career', 'progression', 'grade'],
  reference: ['employment reference', 'job reference', 'referee'],
  jury: ['jury service', 'jury duty', 'court'],
  wedding: ['marriage', 'wedding leave'],
  marriage: ['wedding', 'wedding leave'],
  moving: ['relocation', 'moving house', 'house move'],
  exam: ['study leave', 'examination', 'study'],
  volunteer: ['volunteering', 'charity', 'volunteer day'],
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  leave: ['leave', 'holiday', 'vacation', 'sick', 'annual', 'absence', 'day off', 'time off', 'pto', 'maternity', 'paternity', 'parental', 'bereavement', 'compassionate', 'unpaid', 'carers', 'jury', 'study', 'sabbatical', 'duvet'],
  pay: ['pay', 'salary', 'wage', 'payslip', 'payroll', 'tax', 'pension', 'bonus', 'overtime', 'deduction', 'earnings', 'toil', 'national insurance', 'student loan', 'raise', 'increment'],
  shifts: ['shift', 'rota', 'schedule', 'roster', 'swap', 'working hours', 'overtime', 'night shift', 'weekend'],
  timesheets: ['timesheet', 'hours', 'clock', 'time tracking', 'time entry', 'check in'],
  benefits: ['benefit', 'pension', 'health', 'dental', 'gym', 'cycle', 'childcare', 'voucher', 'perk', 'wellbeing', 'eye test', 'flu jab'],
  rooms: ['room', 'booking', 'meeting room', 'desk', 'space', 'office'],
  elearning: ['training', 'elearning', 'course', 'learning', 'development', 'cpd', 'certification'],
  kudos: ['kudos', 'recognition', 'praise', 'thank', 'appreciation', 'reward', 'shout out'],
  meetings: ['meeting', '1:1', 'one to one', 'check in', 'catch up', 'performance review'],
  performance: ['performance', 'appraisal', 'review', 'objective', 'goal', 'target', 'kpi', 'feedback'],
  onboarding: ['onboarding', 'new starter', 'induction', 'first day', 'probation', 'welcome'],
  policies: ['policy', 'procedure', 'handbook', 'code of conduct', 'dress', 'smoking', 'alcohol', 'drug', 'pet', 'animal', 'remote', 'wfh', 'hybrid', 'flexible', 'grievance', 'disciplinary', 'bullying', 'harassment', 'discrimination', 'data protection', 'gdpr', 'social media', 'internet', 'email', 'phone', 'confidential', 'whistleblowing', 'bribery', 'gift', 'conflict of interest'],
  general: ['manager', 'hr', 'contact', 'help', 'who', 'emergency', 'first aid', 'fire', 'parking', 'wifi', 'it support', 'equipment', 'laptop', 'reference', 'notice', 'resign', 'leaving'],
}

const DATA_INTENT_WORDS = new Set([
  'balance', 'remaining', 'left', 'used', 'taken', 'booked', 'allowance',
  'payslip', 'last pay', 'net pay', 'gross pay', 'tax paid',
  'next shift', 'working tomorrow', 'shifts this week', 'shifts next week',
  'hours worked', 'hours logged', 'hours this week',
  'my manager', 'who is my', 'what department', 'my profile', 'when did i start',
  'my benefits', 'enrolled', 'my courses', 'my training', 'progress',
  'bank holiday', 'company holiday', 'next holiday',
  'expenses', 'owed', 'expense claim', 'submitted',
])

function hasDataIntent(text: string): boolean {
  const lower = text.toLowerCase()
  for (const phrase of DATA_INTENT_WORDS) {
    if (lower.includes(phrase)) return true
  }
  return false
}

function expandWithSynonyms(words: string[]): string[] {
  const expanded = new Set(words)
  for (const w of words) {
    const syns = SYNONYMS[w]
    if (syns) {
      for (const s of syns) expanded.add(s)
    }
  }
  return [...expanded]
}

function inferCategory(words: string[]): string | null {
  const expanded = expandWithSynonyms(words)
  let best: string | null = null
  let bestScore = 0
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0
    for (const w of expanded) {
      if (keywords.some(k => k.includes(w) || w.includes(k))) score++
    }
    if (score > bestScore) {
      bestScore = score
      best = cat
    }
  }
  return bestScore > 0 ? best : null
}

function getSignificantWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

function scoreArticleRelevance(article: HelpArticle, queryWords: string[]): number {
  const question = article.question.toLowerCase()
  const keywords = article.keywords.toLowerCase()
  const answer = article.answer.toLowerCase()
  let score = 0
  let matched = 0
  for (const w of queryWords) {
    const inQ = question.includes(w)
    const inK = keywords.includes(w)
    const inA = answer.includes(w)
    if (inQ) score += 3
    else if (inK) score += 2
    else if (inA) score += 0.5
    if (inQ || inK || inA) matched++
  }
  const matchRatio = matched / queryWords.length
  if (matchRatio < 0.4) return 0
  return score * matchRatio
}

async function executeDataQuery(queryKey: string, employeeId: string, companyId: string, currency: string, params: Record<string, unknown> = {}): Promise<string> {
  switch (queryKey) {
    case 'leave_balance':
    case 'get_leave_balance': {
      const { data: co } = await supabase.from('companies').select('fy_start_month').eq('id', companyId).single()
      const { fyYear, fyStart, fyEnd } = getFYRange(co?.fy_start_month || 4)
      const [balRes, reqRes, pendRes] = await Promise.all([
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
          .lte('start_date', fyEnd),
        supabase.from('leave_requests')
          .select('leave_type_id, days_requested')
          .eq('employee_id', employeeId)
          .eq('company_id', companyId)
          .eq('status', 'pending')
          .gte('start_date', fyStart)
          .lte('start_date', fyEnd)
      ])
      const usedByType = new Map<number, number>()
      for (const r of (reqRes.data || [])) {
        usedByType.set(r.leave_type_id, (usedByType.get(r.leave_type_id) || 0) + Number(r.days_requested))
      }
      const pendByType = new Map<number, number>()
      for (const r of (pendRes.data || [])) {
        pendByType.set(r.leave_type_id, (pendByType.get(r.leave_type_id) || 0) + Number(r.days_requested))
      }
      const data = balRes.data || []
      const balTypeIds = new Set(data.map((b: any) => b.leave_type_id))
      const lines: string[] = []
      for (const b of data) {
        const total = (b.total_allowance || 0) + (b.carried_over || 0) + (b.lieu_days || 0)
        const used = usedByType.get(b.leave_type_id) || 0
        const pend = pendByType.get(b.leave_type_id) || 0
        const remaining = total - used
        const name = (b as any).leave_type?.name || 'Leave'
        const parts = [`${b.total_allowance || 0} allowance`]
        if (b.carried_over) parts.push(`${b.carried_over} carried over`)
        if (b.lieu_days) parts.push(`${b.lieu_days} in lieu`)
        let line = `${name}: ${remaining} days remaining (${used} used of ${total} — ${parts.join(', ')})`
        if (pend > 0) line += ` | ${pend} pending`
        lines.push(line)
      }
      const otherTypeIds = new Set<number>()
      for (const id of usedByType.keys()) { if (!balTypeIds.has(id)) otherTypeIds.add(id) }
      for (const id of pendByType.keys()) { if (!balTypeIds.has(id)) otherTypeIds.add(id) }
      if (otherTypeIds.size > 0) {
        const { data: otherTypes } = await supabase.from('leave_types').select('id, name').in('id', [...otherTypeIds])
        for (const lt of (otherTypes || [])) {
          const used = usedByType.get(lt.id) || 0
          const pend = pendByType.get(lt.id) || 0
          let line = `${lt.name}: ${used} day${used !== 1 ? 's' : ''} taken this year`
          if (pend > 0) line += ` | ${pend} pending`
          lines.push(line)
        }
      }
      if (lines.length === 0) return 'No leave balance data found.'
      const totalRemaining = data.reduce((sum: number, b: any) => {
        const total = (b.total_allowance || 0) + (b.carried_over || 0) + (b.lieu_days || 0)
        return sum + total - (usedByType.get(b.leave_type_id) || 0)
      }, 0)
      const totalUsed = Array.from(usedByType.values()).reduce((s, v) => s + v, 0)
      lines.push(`\nTotal: ${totalRemaining} days remaining across tracked types (${totalUsed} used across all types)`)
      return lines.join('\n')
    }
    case 'leave_requests':
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
    case 'next_shift':
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
    case 'hours_worked':
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
    case 'last_payslip':
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
    case 'my_manager':
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
    case 'my_department': {
      const { data } = await supabase
        .from('employees')
        .select('department, job_title, first_name, last_name, start_date')
        .eq('id', employeeId)
        .eq('company_id', companyId)
        .single()
      if (!data) return 'Profile information not available.'
      return [
        `Name: ${data.first_name} ${data.last_name}`,
        `Job Title: ${data.job_title || 'Not set'}`,
        `Department: ${data.department || 'Not set'}`,
        data.start_date ? `Start Date: ${formatDate(data.start_date)}` : null,
      ].filter(Boolean).join('\n')
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

type LayoutMode = 'mobile' | 'tablet' | 'desktop'
type DockMode = 'center' | 'side'

function getLayoutMode(): LayoutMode {
  const w = window.innerWidth
  if (w < 640) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/^### (.+)$/gm, '<h4 class="hc-md-h">$1</h4>')
  html = html.replace(/^## (.+)$/gm, '<h3 class="hc-md-h">$1</h3>')
  html = html.replace(/^# (.+)$/gm, '<h3 class="hc-md-h">$1</h3>')
  html = html.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul class="hc-md-ul">${m}</ul>`)
  html = html.replace(/\n{2,}/g, '</p><p>')
  html = html.replace(/\n/g, '<br/>')
  html = `<p>${html}</p>`
  html = html.replace(/<p><\/p>/g, '')
  html = html.replace(/<p>(<h[34]|<ul)/g, '<$1'.replace('<$1', (_, tag) => `<${tag}`))
  return html
}

export default function HelpChatBubble() {
  const { features } = useFeatures()
  const { employeeId, employeeName, companyUser, company, session } = useAuth()
  useLanguage()
  useTheme()
  const location = useLocation()

  const [isOpen, setIsOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedArticle, setExpandedArticle] = useState<number | null>(null)
  const [resolvedAnswers, setResolvedAnswers] = useState<Record<number, string>>({})
  const [showChips, setShowChips] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(getLayoutMode)
  const [dockMode, setDockMode] = useState<DockMode>(() => {
    try { return (localStorage.getItem('hc-dock') as DockMode) || 'center' } catch { return 'center' }
  })
  const [userScrolled, setUserScrolled] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<Record<number, 'up' | 'down'>>({})
  const [hasHandbook, setHasHandbook] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const messagesAreaRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const touchStartY = useRef<number | null>(null)

  const companyId = companyUser?.company_id
  const currency = company?.currency || 'GBP'
  const firstName = employeeName?.split(' ')[0] || ''
  const isDesktop = layoutMode === 'desktop'
  const isDocked = isDesktop && dockMode === 'side'

  useEffect(() => {
    function handleResize() { setLayoutMode(getLayoutMode()) }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (isOpen && layoutMode === 'mobile') {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen, layoutMode])

  const scrollToBottom = useCallback(() => {
    if (userScrolled) return
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
  }, [userScrolled])

  useEffect(() => {
    if (!companyId) return
    supabase.from('handbook_sections')
      .select('id', { count: 'exact', head: true })
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq('is_active', true)
      .then(({ count }) => setHasHandbook((count || 0) > 0))
  }, [companyId])

  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen])

  if (!features.employee_help || location.pathname.startsWith('/admin')) return null

  function handleScroll() {
    const el = messagesAreaRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setUserScrolled(!atBottom)
  }

  function jumpToBottom() {
    setUserScrolled(false)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  function handleOpen() {
    setIsOpen(true)
    setIsClosing(false)
    if (messages.length === 0) {
      setMessages([{
        role: 'bot',
        text: `Hi ${firstName}! How can I help you today? Choose a topic below or type your question.`,
      }])
      setShowChips(true)
    }
    setTimeout(() => inputRef.current?.focus(), 300)
  }

  function handleClose() {
    setIsClosing(true)
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 200
    setTimeout(() => {
      setIsOpen(false)
      setIsClosing(false)
      fabRef.current?.focus()
    }, duration)
  }

  function handleNewChat() {
    setMessages([{
      role: 'bot',
      text: `Hi ${firstName}! How can I help you today? Choose a topic below or type your question.`,
    }])
    setExpandedArticle(null)
    setResolvedAnswers({})
    setShowChips(true)
    setSelectedCategory(null)
    setQuery('')
    setFeedback({})
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function toggleDock() {
    const next = dockMode === 'center' ? 'side' : 'center'
    setDockMode(next)
    try { localStorage.setItem('hc-dock', next) } catch { /* */ }
  }

  function handleHeaderTouchStart(e: React.TouchEvent) {
    if (layoutMode !== 'mobile') return
    touchStartY.current = e.touches[0].clientY
  }
  function handleHeaderTouchEnd(e: React.TouchEvent) {
    if (touchStartY.current === null) return
    const diff = e.changedTouches[0].clientY - touchStartY.current
    if (diff > 60) handleClose()
    touchStartY.current = null
  }

  async function searchArticles(searchQuery: string): Promise<HelpArticle[]> {
    if (!companyId) return []
    const queryWords = getSignificantWords(searchQuery)
    if (queryWords.length === 0) return []

    const expandedWords = expandWithSynonyms(queryWords)

    const { data } = await supabase
      .from('help_articles')
      .select('id, category, question, answer, keywords, data_query')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq('is_active', true)
      .textSearch('search_vector', searchQuery, { type: 'websearch' })
      .order('sort_order')
      .limit(10)

    if (data && data.length > 0) {
      const scored = data
        .map(a => ({ article: a, score: scoreArticleRelevance(a, expandedWords) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
      if (scored.length > 0) return scored.slice(0, 5).map(s => s.article)
    }

    const ilikeFilters = expandedWords.map(w =>
      `question.ilike.%${w}%,keywords.ilike.%${w}%,answer.ilike.%${w}%`
    )

    let fallbackArticles: HelpArticle[] = []

    if (expandedWords.length <= 5) {
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
      const topFilters = ilikeFilters.slice(0, 6)
      const { data: partial } = await supabase
        .from('help_articles')
        .select('id, category, question, answer, keywords, data_query')
        .or(`company_id.is.null,company_id.eq.${companyId}`)
        .eq('is_active', true)
        .or(topFilters.join(','))
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

    const scored = unique
      .map(a => ({ article: a, score: scoreArticleRelevance(a, expandedWords) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    return scored.map(s => s.article)
  }

  async function searchCategoryArticles(category: string): Promise<HelpArticle[]> {
    if (!companyId) return []
    const { data } = await supabase
      .from('help_articles')
      .select('id, category, question, answer, keywords, data_query')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq('is_active', true)
      .eq('category', category)
      .order('sort_order')
      .limit(8)
    return data || []
  }

  async function handleCategoryClick(category: string) {
    if (!companyId) return
    setLoading(true)
    setShowChips(false)
    setSelectedCategory(category)

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

  async function callAiAgent(q: string, contextMode: 'handbook_only' | 'faq_only' | 'full' = 'full'): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const res = await fetch(`${supabaseUrl}/functions/v1/ai-help-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session!.access_token}` },
      body: JSON.stringify({ company_id: companyId, query: q, context_mode: contextMode }),
    })
    const data = await res.json()
    return { ok: res.ok, data }
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const q = query.trim()
    if (!q || loading) return
    setQuery('')
    setLoading(true)
    setShowChips(false)

    setMessages(prev => [...prev, { role: 'user', text: q }])

    // ── Tier 1: FAQ text search (zero AI cost) ──
    const articles = await searchArticles(q)
    if (articles.length > 0) {
      logSearch(q, true, articles.length, articles[0]?.id || null)
      setMessages(prev => [...prev, {
        role: 'bot',
        text: `I found ${articles.length} result${articles.length > 1 ? 's' : ''} that might help:`,
        articles,
        askAiQuery: features.ai_help_agent && session ? q : undefined,
      }])
      setLoading(false)
      scrollToBottom()
      return
    }

    // ── Tier 2+: AI-powered responses ──
    if (features.ai_help_agent && session) {
      try {
        // Personal data queries go straight to AI with full context
        if (hasDataIntent(q)) {
          const { ok, data } = await callAiAgent(q, 'full')
          if (ok && data.server_answer) {
            logSearch(q, true, 0, null, true)
            setMessages(prev => [...prev, { role: 'bot', text: data.server_answer as string }])
            setLoading(false)
            scrollToBottom()
            return
          }
          if (ok && data.tool_call && employeeId && companyId) {
            const result = await executeDataQuery(data.tool_call as string, employeeId, companyId, currency, (data.params || {}) as Record<string, unknown>)
            if (result) {
              logSearch(q, true, 0, null, true)
              setMessages(prev => [...prev, { role: 'bot', text: result }])
            } else {
              logSearch(q, false, 0, null, true)
              setMessages(prev => [...prev, { role: 'bot', text: "I looked that up but couldn't find any data. Try rephrasing your question or contact your HR team for help." }])
            }
            setLoading(false)
            scrollToBottom()
            return
          }
          if (ok && data.answer) {
            logSearch(q, true, 0, null, true)
            setMessages(prev => [...prev, { role: 'bot', text: data.answer as string }])
            setLoading(false)
            scrollToBottom()
            return
          }
        }

        // Tier 2: Handbook search (if company has handbook — smaller prompt, ~75% fewer tokens)
        if (hasHandbook) {
          const { ok, data } = await callAiAgent(q, 'handbook_only')
          if (ok && data.answer && !(data.answer as string).includes("I'm not able to help")) {
            logSearch(q, true, 0, null, true)
            setMessages(prev => [...prev, {
              role: 'bot',
              text: data.answer as string,
              sourcePolicy: 'handbook',
            }])
            setLoading(false)
            scrollToBottom()
            return
          }
        }

        // Tier 3: AI with FAQ context (full fallback)
        const { ok, data } = await callAiAgent(q, hasHandbook ? 'faq_only' : 'full')
        if (ok && data.server_answer) {
          logSearch(q, true, 0, null, true)
          setMessages(prev => [...prev, { role: 'bot', text: data.server_answer as string }])
          setLoading(false)
          scrollToBottom()
          return
        }
        if (ok && data.tool_call && employeeId && companyId) {
          const result = await executeDataQuery(data.tool_call as string, employeeId, companyId, currency, (data.params || {}) as Record<string, unknown>)
          if (result) {
            logSearch(q, true, 0, null, true)
            setMessages(prev => [...prev, { role: 'bot', text: result }])
          } else {
            logSearch(q, false, 0, null, true)
            setMessages(prev => [...prev, { role: 'bot', text: "I looked that up but couldn't find any data. Try rephrasing your question or contact your HR team for help." }])
          }
          setLoading(false)
          scrollToBottom()
          return
        }
        if (ok && data.answer) {
          logSearch(q, true, 0, null, true)
          setMessages(prev => [...prev, { role: 'bot', text: data.answer as string }])
          setLoading(false)
          scrollToBottom()
          return
        }
      } catch {
        // Fall through to category inference below
      }
    }

    // ── Tier 4: Category inference fallback (no AI) ──
    const queryWords = getSignificantWords(q)
    const inferredCat = inferCategory(queryWords)

    if (inferredCat) {
      const catArticles = await searchCategoryArticles(inferredCat)
      const catLabel = CATEGORIES.find(c => c.key === inferredCat)?.label || inferredCat

      if (catArticles.length > 0) {
        logSearch(q, true, catArticles.length, catArticles[0]?.id || null)
        setMessages(prev => [...prev, {
          role: 'bot',
          text: `I didn't find an exact match, but here are some ${catLabel.toLowerCase()} articles that might help:`,
          articles: catArticles,
          askAiQuery: features.ai_help_agent && session ? q : undefined,
        }])
        setLoading(false)
        scrollToBottom()
        return
      }
    }

    logSearch(q, false, 0, null)
    setMessages(prev => [...prev, {
      role: 'bot',
      text: "Sorry, I couldn't find a related answer for that question. Try rephrasing with different keywords, browse a topic below, or contact your HR team directly for help.",
      askAiQuery: features.ai_help_agent && session ? q : undefined,
    }])
    setShowChips(true)
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

  async function handleAskAi(originalQuery: string, msgIndex: number) {
    if (loading || !session || !companyId) return
    setLoading(true)
    setMessages(prev => prev.map((m, i) => i === msgIndex ? { ...m, askAiQuery: undefined } : m))

    try {
      const { ok, data } = await callAiAgent(originalQuery, 'full')
      if (ok && data.server_answer) {
        logSearch(originalQuery, true, 0, null, true)
        setMessages(prev => [...prev, { role: 'bot', text: data.server_answer as string }])
      } else if (ok && data.tool_call && employeeId && companyId) {
        const result = await executeDataQuery(data.tool_call as string, employeeId, companyId, currency, (data.params || {}) as Record<string, unknown>)
        if (result) {
          logSearch(originalQuery, true, 0, null, true)
          setMessages(prev => [...prev, { role: 'bot', text: result }])
        } else {
          setMessages(prev => [...prev, { role: 'bot', text: "I looked that up but couldn't find any data. Try rephrasing your question or contact your HR team for help." }])
        }
      } else if (ok && data.answer) {
        logSearch(originalQuery, true, 0, null, true)
        setMessages(prev => [...prev, { role: 'bot', text: data.answer as string }])
      } else {
        setMessages(prev => [...prev, {
          role: 'bot',
          text: "Sorry, the HR AI couldn't find a better answer. Try rephrasing your question or contact your HR team directly for help.",
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'bot',
        text: "Sorry, the HR AI couldn't find a better answer. Try rephrasing your question or contact your HR team directly for help.",
      }])
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
    'hc-panel',
    `hc-${layoutMode}`,
    isDocked ? 'hc-docked' : '',
    isClosing ? 'hc-closing' : 'hc-opening',
  ].filter(Boolean).join(' ')

  const overlayClass = `hc-overlay ${isClosing ? 'hc-overlay-closing' : 'hc-overlay-opening'}`

  // Desktop sidebar with topics
  const sidebarContent = isDesktop && !isDocked && (
    <div className="hc-sidebar">
      <div className="hc-sidebar-section">
        <div className="hc-sidebar-label">Topics</div>
        <div className="hc-sidebar-topics">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              className={`hc-sidebar-topic ${selectedCategory === cat.key ? 'hc-sidebar-topic-active' : ''}`}
              onClick={() => handleCategoryClick(cat.key)}
            >
              <span className="hc-sidebar-topic-icon">{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )

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
            className="hc-header"
            onTouchStart={handleHeaderTouchStart}
            onTouchEnd={handleHeaderTouchEnd}
          >
            {layoutMode === 'mobile' && <div className="hc-handle" />}
            <div className="hc-header-left">
              <div className="hc-header-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div className="hc-header-info">
                <span className="hc-header-name">{ASSISTANT_NAME}</span>
                <span className="hc-header-status">
                  <span className="hc-status-dot" />
                  Online · answers from your company's policies
                </span>
              </div>
            </div>
            <div className="hc-header-actions">
              {messages.length > 1 && (
                <button className="hc-header-btn" onClick={handleNewChat} aria-label="New chat" title="New chat">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                  </svg>
                </button>
              )}
              {isDesktop && (
                <button className="hc-header-btn" onClick={toggleDock} aria-label={isDocked ? 'Centre panel' : 'Dock to side'} title={isDocked ? 'Centre panel' : 'Dock to side'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {isDocked ? (
                      <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></>
                    ) : (
                      <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></>
                    )}
                  </svg>
                </button>
              )}
              <button className="hc-header-btn" onClick={handleClose} aria-label="Close" title="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="hc-body">
            {sidebarContent}

            <div className="hc-main">
              {/* Messages area */}
              <div className="hc-messages" ref={messagesAreaRef} onScroll={handleScroll}>
                <div aria-live="polite" aria-atomic="false" className="hc-sr-only" />

                {messages.map((msg, i) => (
                  <div key={i} className={`hc-msg hc-msg-${msg.role}`}>
                    {msg.role === 'bot' && (
                      <div className="hc-msg-avatar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                      </div>
                    )}
                    <div className={`hc-msg-content ${msg.role === 'user' ? 'hc-msg-user-bubble' : 'hc-msg-bot-card'}`}>
                      <div
                        className="hc-msg-text"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                      />

                      {msg.articles && msg.articles.length > 0 && (
                        <div className="hc-articles">
                          {msg.articles.map(article => (
                            <button
                              key={article.id}
                              data-article-id={article.id}
                              className={`hc-article ${expandedArticle === article.id ? 'hc-article-expanded' : ''}`}
                              onClick={() => handleArticleClick(article)}
                            >
                              <div className="hc-article-q">
                                <span>{article.question}</span>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expandedArticle === article.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                                  <polyline points="6 9 12 15 18 9"/>
                                </svg>
                              </div>
                              {expandedArticle === article.id && (
                                <div className="hc-article-a">
                                  {(resolvedAnswers[article.id] || article.answer).split('\n').map((line, li) => (
                                    <p key={li}>{line}</p>
                                  ))}
                                  {article.data_query && !resolvedAnswers[article.id] && (
                                    <p style={{ fontStyle: 'italic', opacity: 0.7 }}>Loading your data...</p>
                                  )}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {msg.role === 'bot' && !msg.articles && i > 0 && (
                        <div className="hc-msg-actions">
                          <button
                            className="hc-msg-action-btn"
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
                            className={`hc-msg-action-btn ${feedback[i] === 'up' ? 'hc-feedback-active' : ''}`}
                            onClick={() => setFeedback(prev => ({ ...prev, [i]: 'up' }))}
                            title="Helpful"
                            aria-label="Mark as helpful"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill={feedback[i] === 'up' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                          </button>
                          <button
                            className={`hc-msg-action-btn ${feedback[i] === 'down' ? 'hc-feedback-active' : ''}`}
                            onClick={() => setFeedback(prev => ({ ...prev, [i]: 'down' }))}
                            title="Not helpful"
                            aria-label="Mark as not helpful"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill={feedback[i] === 'down' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                          </button>
                        </div>
                      )}

                      {msg.askAiQuery && (
                        <button
                          className="hc-ask-ai"
                          onClick={() => handleAskAi(msg.askAiQuery!, i)}
                          disabled={loading}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93"/>
                            <path d="M8.24 4.77A4 4 0 0 1 12 2"/>
                            <path d="M14 10.5V19a2 2 0 0 1-4 0v-8.5"/>
                            <circle cx="12" cy="6" r="1"/>
                          </svg>
                          Not what you need? Ask HR AI
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {showChips && (!isDesktop || isDocked) && (
                  <div className="hc-topic-dropdown-wrap">
                    <select
                      className="hc-topic-dropdown"
                      value=""
                      onChange={(ev) => {
                        const val = ev.target.value
                        if (val) handleCategoryClick(val)
                      }}
                    >
                      <option value="" disabled>Browse by topic...</option>
                      {CATEGORIES.map(cat => (
                        <option key={cat.key} value={cat.key}>{cat.icon} {cat.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {showChips && isDesktop && !isDocked && (
                  <div className="hc-welcome-chips">
                    {CATEGORIES.map(cat => (
                      <button key={cat.key} className="hc-chip" onClick={() => handleCategoryClick(cat.key)}>
                        <span className="hc-chip-icon">{cat.icon}</span>
                        {cat.label}
                      </button>
                    ))}
                  </div>
                )}

                {loading && (
                  <div className="hc-msg hc-msg-bot">
                    <div className="hc-msg-avatar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </div>
                    <div className="hc-msg-content hc-msg-bot-card">
                      <div className="hc-typing">
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Jump to bottom */}
              {userScrolled && (
                <button className="hc-jump-btn" onClick={jumpToBottom} aria-label="Jump to latest message">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                  New message
                </button>
              )}

              {/* Input */}
              <div className="hc-input-area">
                <form className="hc-input-form" onSubmit={handleSubmit}>
                  <textarea
                    ref={inputRef}
                    className="hc-textarea"
                    value={query}
                    onChange={e => { setQuery(e.target.value); autoGrowTextarea(e.target) }}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder="Type your question..."
                    maxLength={500}
                    disabled={loading}
                    rows={1}
                  />
                  <button
                    type="submit"
                    className="hc-send-btn"
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
                  <div className="hc-input-hint">Enter to send · Shift + Enter for a new line · Esc to close</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isOpen && (
        <button ref={fabRef} className="hc-fab" onClick={handleOpen} aria-label={`Open ${ASSISTANT_NAME}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      )}
    </>
  )
}
