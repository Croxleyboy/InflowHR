import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VIRUSTOTAL_API_KEY = Deno.env.get('VIRUSTOTAL_API_KEY')
const ALLOWED_ORIGIN = 'https://app.inflowhr.com'

const ALLOWED_BUCKETS: Record<string, string> = {
  'employee-documents': 'employee_documents',
  'benefit-documents': 'benefit_documents',
  'sage-payslips': 'sage-payslips',
}

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { storagePath, documentId, company_id } = body
    const bucket = body.bucket || 'employee-documents'
    const tableName = body.tableName || 'employee_documents'

    if (!storagePath || !documentId || !company_id) {
      return new Response(JSON.stringify({ error: 'Missing storagePath, documentId, or company_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!ALLOWED_BUCKETS[bucket]) {
      return new Response(JSON.stringify({ error: 'Invalid bucket' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!Object.values(ALLOWED_BUCKETS).includes(tableName) && tableName !== 'sage-payslips') {
      return new Response(JSON.stringify({ error: 'Invalid table' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: cu } = await sbAdmin.from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .maybeSingle()
    if (!cu || !['admin', 'hr'].includes(cu.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden — admin or HR role required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const updateStatus = async (status: string) => {
      if (tableName === 'sage-payslips') return
      await sbAdmin.from(tableName)
        .update({ scan_status: status })
        .eq('id', documentId)
        .eq('company_id', company_id)
    }

    if (!VIRUSTOTAL_API_KEY) {
      await updateStatus('skipped')
      return new Response(JSON.stringify({ status: 'skipped', reason: 'No VirusTotal API key configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await updateStatus('scanning')

    const { data: fileData, error: dlErr } = await supabase.storage
      .from(bucket)
      .download(storagePath)

    if (dlErr || !fileData) {
      await updateStatus('error')
      return new Response(JSON.stringify({ error: 'Failed to download file for scanning' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const formData = new FormData()
    formData.append('file', fileData, storagePath.split('/').pop() || 'file')

    const uploadRes = await fetch('https://www.virustotal.com/api/v3/files', {
      method: 'POST',
      headers: { 'x-apikey': VIRUSTOTAL_API_KEY },
      body: formData,
    })

    if (!uploadRes.ok) {
      await updateStatus('error')
      return new Response(JSON.stringify({ error: 'VirusTotal upload failed', detail: await uploadRes.text() }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const uploadResult = await uploadRes.json()
    const analysisId = uploadResult?.data?.id

    if (!analysisId) {
      await updateStatus('error')
      return new Response(JSON.stringify({ error: 'No analysis ID returned' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let attempts = 0
    const maxAttempts = 12
    let scanResult = null

    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 5000))
      attempts++

      const analysisRes = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
        headers: { 'x-apikey': VIRUSTOTAL_API_KEY },
      })

      if (!analysisRes.ok) continue

      const analysis = await analysisRes.json()
      const status = analysis?.data?.attributes?.status

      if (status === 'completed') {
        scanResult = analysis.data.attributes
        break
      }
    }

    if (!scanResult) {
      await updateStatus('timeout')
      return new Response(JSON.stringify({ status: 'timeout', message: 'Scan did not complete in time' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const stats = scanResult.stats || {}
    const malicious = (stats.malicious || 0) + (stats.suspicious || 0)
    const isSafe = malicious === 0

    if (isSafe) {
      await updateStatus('clean')
    } else {
      await supabase.storage.from(bucket).remove([storagePath])
      await updateStatus('infected')
    }

    return new Response(JSON.stringify({
      status: isSafe ? 'clean' : 'infected',
      stats: { malicious: stats.malicious || 0, suspicious: stats.suspicious || 0, harmless: stats.harmless || 0, undetected: stats.undetected || 0 },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
