import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGIN = 'https://app.inflowhr.com'

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

    const { data: superAdmin } = await sb.from('super_admins')
      .select('id').eq('email', user.email).maybeSingle()
    if (!superAdmin) return json({ error: 'Super admin access required' }, 403)

    const { action, api_key } = await req.json()

    if (action === 'save_key') {
      if (!api_key || typeof api_key !== 'string' || !api_key.startsWith('sk-')) {
        return json({ error: 'Invalid API key format — must start with sk-' }, 400)
      }

      await sb.from('platform_secrets').upsert(
        { key_name: 'openai_api_key', key_value: api_key, updated_at: new Date().toISOString(), updated_by: user.id },
        { onConflict: 'key_name' },
      )

      return json({ success: true, message: 'API key saved' })
    }

    if (action === 'test') {
      let testKey = api_key

      if (!testKey) {
        const { data: secret } = await sb.from('platform_secrets')
          .select('key_value').eq('key_name', 'openai_api_key').maybeSingle()
        testKey = secret?.key_value
      }

      if (!testKey) {
        testKey = Deno.env.get('OPENAI_API_KEY')
      }

      if (!testKey) {
        return json({ error: 'No API key configured — enter a key and save it first' }, 400)
      }

      const modelsRes = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${testKey}` },
      })

      if (!modelsRes.ok) {
        const errText = await modelsRes.text()
        if (modelsRes.status === 401) return json({ error: 'Invalid API key — authentication failed', connected: false }, 400)
        if (modelsRes.status === 429) return json({ error: 'Rate limited — too many requests. Try again in a moment.', connected: false }, 429)
        return json({ error: `OpenAI API error: ${errText}`, connected: false }, 502)
      }

      const modelsData = await modelsRes.json()
      const modelIds: string[] = (modelsData.data || []).map((m: { id: string }) => m.id)
      const hasGpt4oMini = modelIds.some(id => id.includes('gpt-4o-mini'))

      return json({
        connected: true,
        model_available: hasGpt4oMini,
        model: 'gpt-4o-mini-2024-07-18',
        total_models: modelIds.length,
      })
    }

    if (action === 'get_key_status') {
      const { data: secret } = await sb.from('platform_secrets')
        .select('key_value, updated_at').eq('key_name', 'openai_api_key').maybeSingle()

      const envKeySet = !!Deno.env.get('OPENAI_API_KEY')

      return json({
        has_db_key: !!secret?.key_value,
        has_env_key: envKeySet,
        key_preview: secret?.key_value ? `sk-...${secret.key_value.slice(-4)}` : null,
        updated_at: secret?.updated_at || null,
      })
    }

    if (action === 'delete_key') {
      await sb.from('platform_secrets').delete().eq('key_name', 'openai_api_key')
      return json({ success: true, message: 'API key removed' })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch {
    return json({ error: 'Internal server error' }, 500)
  }
})
