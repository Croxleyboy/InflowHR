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

    const { data: cu } = await sb.from('company_users')
      .select('id').eq('auth_user_id', user.id).eq('company_id', company_id).maybeSingle()
    if (!cu) return json({ error: 'Not a member of this company' }, 403)

    const { data: emp } = await sb.from('employees')
      .select('id').eq('auth_user_id', user.id).eq('company_id', company_id).maybeSingle()
    if (!emp) return json({ error: 'Employee not found' }, 404)

    const { data: feature } = await sb.from('company_features')
      .select('is_enabled').eq('company_id', company_id).eq('feature_key', 'ai_help_agent').maybeSingle()
    if (!feature?.is_enabled) return json({ error: 'AI Help Agent is not enabled for this company' }, 403)

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

    const systemPrompt = `You are a friendly, professional HR assistant for a company's employee help service. Your role is to answer employee questions using ONLY the FAQ articles provided below.

Rules:
- Answer conversationally, as if you are an experienced HR colleague
- Be concise — keep answers under 150 words
- Use ONLY information from the FAQ articles below. Do not invent policies, dates, or procedures
- If the FAQ articles do not cover the employee's question, respond: "I'm not able to help with that specific question. I'd suggest contacting your HR team directly — they'll be able to assist you."
- Never mention that you are AI, a chatbot, or that you are reading FAQ articles
- Never reference article numbers or say things like "according to article 3"
- Use a warm, helpful tone

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
        max_tokens: 300,
        temperature: 0.3,
      }),
    })

    if (!openaiRes.ok) {
      const err = await openaiRes.text()
      return json({ error: `AI service error: ${err}` }, 502)
    }

    const openaiData = await openaiRes.json()
    const answer = openaiData.choices?.[0]?.message?.content?.trim()

    if (!answer) return json({ error: 'No response from AI service' }, 502)

    return json({ answer })
  } catch {
    return json({ error: 'Internal server error' }, 500)
  }
})
