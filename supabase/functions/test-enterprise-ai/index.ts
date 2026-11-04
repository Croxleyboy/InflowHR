import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, detail: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ ok: false, detail: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { company_id } = await req.json()
    if (!company_id) {
      return new Response(JSON.stringify({ ok: false, detail: 'Missing company_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: cu } = await supabase
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .single()

    if (!cu || !['admin', 'hr'].includes(cu.role)) {
      return new Response(JSON.stringify({ ok: false, detail: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: eai } = await supabase
      .from('enterprise_ai_integrations')
      .select('ai_endpoint, ai_api_key, ai_model, ai_api_version')
      .eq('company_id', company_id)
      .single()

    if (!eai?.ai_endpoint || !eai?.ai_api_key) {
      return new Response(JSON.stringify({ ok: false, detail: 'Enterprise AI not configured — save endpoint and API key first' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const model = eai.ai_model || 'gpt-4o'
    const apiVersion = eai.ai_api_version || '2024-06-01'
    const url = `${eai.ai_endpoint.replace(/\/+$/, '')}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': eai.ai_api_key },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hello' }], max_tokens: 5 }),
    })

    const now = new Date().toISOString()
    if (resp.ok) {
      await supabase.from('enterprise_ai_integrations').update({
        last_test_at: now,
        last_test_ok: true,
        status: 'connected',
        status_detail: null,
      }).eq('company_id', company_id)

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await resp.text().catch(() => '')
    const detail = resp.status === 401
      ? 'Invalid API key'
      : resp.status === 404
        ? 'Model deployment not found — check the model name'
        : `HTTP ${resp.status}: ${body.slice(0, 120)}`

    await supabase.from('enterprise_ai_integrations').update({
      last_test_at: now,
      last_test_ok: false,
      status: 'error',
      status_detail: detail,
    }).eq('company_id', company_id)

    return new Response(JSON.stringify({ ok: false, detail }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Internal error'
    return new Response(JSON.stringify({ ok: false, detail }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
