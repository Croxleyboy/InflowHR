import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://app.inflowhr.com'
const DAILY_LIMIT = 20

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const DATA_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_leave_balance',
      description: 'Get the employee\'s current leave balance — total allowance, days used, days remaining, and carried over, broken down by leave type (Annual Leave, Sick Leave, etc.). Use for questions like "how many days do I have left", "what is my leave balance".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_leave_requests',
      description: 'Get the employee\'s leave requests. Can filter by date range and/or status. Use for "how many days did I take in December", "show my approved leave", "when is my next holiday".',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Start of date range (YYYY-MM-DD). If month mentioned, use first day of that month.' },
          end_date: { type: 'string', description: 'End of date range (YYYY-MM-DD). If month mentioned, use last day of that month.' },
          status: { type: 'string', enum: ['approved', 'pending', 'rejected', 'cancelled'], description: 'Filter by status. Omit to return all statuses.' },
          upcoming_only: { type: 'boolean', description: 'If true, only return requests from today onwards.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_expense_claims',
      description: 'Get the employee\'s expense claims. Can filter by date range and/or status. Use for "what expenses did I submit", "how much am I owed", "pending expenses".',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Start of date range (YYYY-MM-DD).' },
          end_date: { type: 'string', description: 'End of date range (YYYY-MM-DD).' },
          status: { type: 'string', enum: ['submitted', 'approved', 'rejected', 'paid'], description: 'Filter by status.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_next_shifts',
      description: 'Get the employee\'s upcoming shift assignments. Use for "when is my next shift", "what shifts do I have this week", "am I working tomorrow".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of upcoming shifts to return (default 5).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_hours_worked',
      description: 'Get the employee\'s timesheet hours for a date range. Use for "how many hours did I work this week", "hours logged in October".',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Start of date range (YYYY-MM-DD). Defaults to start of current week.' },
          end_date: { type: 'string', description: 'End of date range (YYYY-MM-DD). Defaults to today.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_payslip_summary',
      description: 'Get the employee\'s recent payslip(s). Use for "what was my last pay", "how much tax did I pay", "show my payslip".',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Number of recent payslips to return (default 1, max 3).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_my_profile',
      description: 'Get the employee\'s own profile information — name, job title, department, start date, manager. Use for "who is my manager", "what department am I in", "when did I start".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_benefits',
      description: 'Get the employee\'s enrolled benefits. Use for "what benefits do I have", "am I enrolled in anything".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_elearning_progress',
      description: 'Get the employee\'s e-learning course progress. Use for "what courses do I have", "have I completed my training", "e-learning progress".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_upcoming_holidays',
      description: 'Get company public/bank holidays. Use for "when is the next bank holiday", "company holidays", "days off this year".',
      parameters: {
        type: 'object',
        properties: {
          upcoming_only: { type: 'boolean', description: 'If true, only return holidays from today onwards (default true).' },
        },
        required: [],
      },
    },
  },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await sb.auth.getUser(jwt)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { company_id, query } = await req.json()
    if (!company_id || !query) return json({ error: 'Missing company_id or query' }, 400)

    const { data: superAdmin } = await sb.from('super_admins')
      .select('id').eq('email', user.email).maybeSingle()

    const { data: cu } = await sb.from('company_users')
      .select('id').eq('auth_user_id', user.id).eq('company_id', company_id).maybeSingle()
    if (!cu && !superAdmin) return json({ error: 'Not a member of this company' }, 403)

    const { data: emp } = await sb.from('employees')
      .select('id').eq('auth_user_id', user.id).eq('company_id', company_id).maybeSingle()
    if (!emp && !superAdmin) return json({ error: 'Employee not found' }, 404)

    const { data: feature } = await sb.from('company_features')
      .select('is_enabled').eq('company_id', company_id).eq('feature_key', 'ai_help_agent').maybeSingle()
    if (!feature?.is_enabled) return json({ error: 'AI Help Agent is not enabled for this company' }, 403)

    if (emp) {
      const today = new Date().toISOString().slice(0, 10)
      const { data: usage } = await sb.from('ai_help_usage')
        .select('query_count').eq('company_id', company_id).eq('employee_id', emp.id).eq('query_date', today).maybeSingle()

      if (usage && usage.query_count >= DAILY_LIMIT) {
        return json({ error: 'Daily AI query limit reached. Please try again tomorrow or browse the help topics.' }, 429)
      }

      await sb.from('ai_help_usage').upsert(
        { company_id, employee_id: emp.id, query_date: today, query_count: (usage?.query_count || 0) + 1 },
        { onConflict: 'company_id,employee_id,query_date' },
      )
    }

    const { data: secretRow } = await sb.from('platform_secrets')
      .select('key_value').eq('key_name', 'openai_api_key').maybeSingle()
    const apiKey = secretRow?.key_value || Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return json({ error: 'OpenAI API key not configured. A super admin must add it in Admin > Integrations.' }, 503)

    const { data: articles } = await sb.from('help_articles')
      .select('question, answer, category, keywords')
      .or(`company_id.is.null,company_id.eq.${company_id}`)
      .eq('is_active', true)
      .order('sort_order')
      .limit(50)

    const faqContext = (articles || [])
      .map((a, i) => `[${i + 1}] Category: ${a.category}\nQ: ${a.question}\nA: ${a.answer}`)
      .join('\n\n')

    const systemPrompt = `You are a friendly, professional HR assistant for a company's employee help service.

You have two capabilities:
1. Answer policy/general HR questions using the FAQ articles provided below.
2. Look up the employee's personal HR data using the available tools (leave balance, leave requests, expenses, shifts, payslips, etc.).

Rules:
- If the employee is asking about their own data (leave taken, days remaining, expenses, shifts, payslips, manager, hours worked, benefits, training), use the appropriate tool. Always prefer a tool call over a generic FAQ answer when the question is about the employee's personal information.
- For policy, process, or general questions, answer using ONLY the FAQ articles below. Do not invent policies.
- Be concise — keep answers under 150 words.
- If neither tools nor FAQ articles can help, respond: "I'm not able to help with that specific question. I'd suggest contacting your HR team directly — they'll be able to assist you."
- Never mention that you are AI, a chatbot, or that you are reading FAQ articles.
- Never reference article numbers.
- Use a warm, helpful tone. Use day-month-year date format (e.g. 15 December 2025).
- When a question references relative dates like "last month" or "this year", calculate the correct date range based on today's date: ${new Date().toISOString().slice(0, 10)}.

FAQ Articles:
${faqContext}`

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        tools: DATA_TOOLS,
        tool_choice: 'auto',
        max_tokens: 300,
        temperature: 0.3,
      }),
    })

    if (!openaiRes.ok) {
      const err = await openaiRes.text()
      return json({ error: `AI service error: ${err}` }, 502)
    }

    const openaiData = await openaiRes.json()
    const msg = openaiData.choices?.[0]?.message

    if (!msg) return json({ error: 'No response from AI service' }, 502)

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls[0]
      let params: Record<string, unknown> = {}
      try { params = JSON.parse(tc.function.arguments || '{}') } catch { /* empty */ }
      return json({ tool_call: tc.function.name, params })
    }

    const answer = msg.content?.trim()
    if (!answer) return json({ error: 'No response from AI service' }, 502)

    return json({ answer })
  } catch {
    return json({ error: 'Internal server error' }, 500)
  }
})
