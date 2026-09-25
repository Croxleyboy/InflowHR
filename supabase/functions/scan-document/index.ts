import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VIRUSTOTAL_API_KEY = Deno.env.get('VIRUSTOTAL_API_KEY')
const ALLOWED_ORIGIN = 'https://app.inflowhr.com'

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

    const { storagePath, documentId } = await req.json()
    if (!storagePath || !documentId) {
      return new Response(JSON.stringify({ error: 'Missing storagePath or documentId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!VIRUSTOTAL_API_KEY) {
      await supabase.from('employee_documents')
        .update({ scan_status: 'skipped' })
        .eq('id', documentId)

      return new Response(JSON.stringify({ status: 'skipped', reason: 'No VirusTotal API key configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await supabase.from('employee_documents')
      .update({ scan_status: 'scanning' })
      .eq('id', documentId)

    const { data: fileData, error: dlErr } = await supabase.storage
      .from('employee-documents')
      .download(storagePath)

    if (dlErr || !fileData) {
      await supabase.from('employee_documents')
        .update({ scan_status: 'error' })
        .eq('id', documentId)

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
      await supabase.from('employee_documents')
        .update({ scan_status: 'error' })
        .eq('id', documentId)

      return new Response(JSON.stringify({ error: 'VirusTotal upload failed', detail: await uploadRes.text() }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const uploadResult = await uploadRes.json()
    const analysisId = uploadResult?.data?.id

    if (!analysisId) {
      await supabase.from('employee_documents')
        .update({ scan_status: 'error' })
        .eq('id', documentId)

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
      await supabase.from('employee_documents')
        .update({ scan_status: 'timeout' })
        .eq('id', documentId)

      return new Response(JSON.stringify({ status: 'timeout', message: 'Scan did not complete in time' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const stats = scanResult.stats || {}
    const malicious = (stats.malicious || 0) + (stats.suspicious || 0)
    const isSafe = malicious === 0

    if (isSafe) {
      await supabase.from('employee_documents')
        .update({ scan_status: 'clean' })
        .eq('id', documentId)
    } else {
      await supabase.storage.from('employee-documents').remove([storagePath])

      await supabase.from('employee_documents')
        .update({ scan_status: 'infected' })
        .eq('id', documentId)
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
