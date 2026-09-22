import { getSupabase, parseSagePayslipText, corsHeaders, json } from '../_shared/sage.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = getSupabase()

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const { data: { user }, error: authErr } = await sb.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { company_id, file_path, filename } = await req.json()
    if (!company_id) return json({ error: 'company_id required' }, 400)
    if (!file_path) return json({ error: 'file_path required' }, 400)

    if (!file_path.startsWith(`${company_id}/`)) {
      return json({ error: 'File path must be scoped to your company' }, 403)
    }

    const { data: cu } = await sb
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) {
      return json({ error: 'Only admins/HR can upload Sage payslips' }, 403)
    }

    const { data: fileData, error: dlErr } = await sb.storage
      .from('sage-payslips')
      .download(file_path)
    if (dlErr || !fileData) {
      return json({ error: `Failed to download file: ${dlErr?.message || 'not found'}` }, 400)
    }

    let pdfText: string
    if (file_path.endsWith('.txt')) {
      pdfText = await fileData.text()
    } else {
      const arrayBuf = await fileData.arrayBuffer()
      pdfText = await extractTextFromPdfBytes(new Uint8Array(arrayBuf))
    }

    const parsed = parseSagePayslipText(pdfText)
    if (parsed.length === 0) {
      return json({ error: 'No payslip data found in the uploaded file. Ensure it is a Sage payslip export.' }, 400)
    }

    const { data: employees } = await sb
      .from('employees')
      .select('id, employee_number, first_name, last_name')
      .eq('company_id', company_id)
      .eq('is_active', true)

    const empByNumber: Record<string, { id: string; name: string }> = {}
    for (const e of (employees || [])) {
      if (e.employee_number) {
        empByNumber[e.employee_number.toUpperCase()] = {
          id: e.id,
          name: `${e.first_name} ${e.last_name}`,
        }
      }
    }

    const matched: { employee_name: string; employee_number: string; net_pay: number; period: string }[] = []
    const unmatched: { employee_name: string; employee_number: string }[] = []
    const upsertRows: Record<string, unknown>[] = []

    for (const ps of parsed) {
      const emp = empByNumber[ps.employee_number.toUpperCase()]
      if (!emp) {
        unmatched.push({ employee_name: ps.employee_name, employee_number: ps.employee_number })
        continue
      }

      const ref = `SAGE-${ps.employee_number}-${ps.pay_period_start}`

      upsertRows.push({
        employee_id: emp.id,
        company_id,
        reference_number: ref,
        pay_period_start: ps.pay_period_start,
        pay_period_end: ps.pay_period_end,
        gross_pay: ps.gross_pay,
        tax: ps.tax,
        national_insurance: ps.national_insurance,
        pension: ps.pension,
        other_deductions: ps.other_deductions,
        net_pay: ps.net_pay,
        payment_date: ps.payment_date,
        status: 'paid',
        source: 'sage',
        tax_code: ps.tax_code,
      })

      matched.push({
        employee_name: emp.name,
        employee_number: ps.employee_number,
        net_pay: ps.net_pay,
        period: `${ps.pay_period_start} — ${ps.pay_period_end}`,
      })
    }

    // Check for month conflicts — block import for months already paid by another source
    const importMonths = [...new Set(upsertRows.map((r: any) => r.pay_period_start?.slice(0, 7)).filter(Boolean))]
    const skipped: { employee_name: string; employee_number: string; month: string; existing_source: string }[] = []
    if (importMonths.length > 0) {
      const { data: existingPayslips } = await sb
        .from('payslips')
        .select('employee_id, pay_period_start, source')
        .eq('company_id', company_id)
        .neq('source', 'sage')
        .in('pay_period_start', upsertRows.map((r: any) => r.pay_period_start))

      if (existingPayslips && existingPayslips.length > 0) {
        const paidSet = new Set(existingPayslips.map((p: any) => `${p.employee_id}|${p.pay_period_start}`))
        const paidSourceMap: Record<string, string> = {}
        for (const p of existingPayslips) paidSourceMap[`${p.employee_id}|${p.pay_period_start}`] = p.source || 'inflowhr'

        const filteredRows: Record<string, unknown>[] = []
        const filteredMatched: typeof matched = []
        for (let i = 0; i < upsertRows.length; i++) {
          const key = `${(upsertRows[i] as any).employee_id}|${(upsertRows[i] as any).pay_period_start}`
          if (paidSet.has(key)) {
            skipped.push({
              employee_name: matched[i]?.employee_name || '',
              employee_number: matched[i]?.employee_number || '',
              month: (upsertRows[i] as any).pay_period_start?.slice(0, 7),
              existing_source: paidSourceMap[key] || 'inflowhr',
            })
          } else {
            filteredRows.push(upsertRows[i])
            if (matched[i]) filteredMatched.push(matched[i])
          }
        }
        upsertRows.length = 0
        upsertRows.push(...filteredRows)
        matched.length = 0
        matched.push(...filteredMatched)
      }
    }

    if (upsertRows.length > 0) {
      const batchSize = 50
      for (let i = 0; i < upsertRows.length; i += batchSize) {
        const batch = upsertRows.slice(i, i + batchSize)
        const { error: upsertErr } = await sb
          .from('payslips')
          .upsert(batch, { onConflict: 'reference_number,company_id' })
        if (upsertErr) {
          return json({ error: `Failed to save payslips (batch ${Math.floor(i / batchSize) + 1}): ${upsertErr.message}` }, 500)
        }
      }
    }

    await sb.from('sage_integrations').upsert({
      company_id,
      sync_status: 'connected',
      sync_error: null,
      payslip_source: 'sage',
      last_upload_at: new Date().toISOString(),
      last_upload_filename: filename || file_path.split('/').pop() || 'sage-payslips.pdf',
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })

    await sb.rpc('log_gdpr_action', {
      p_action: 'CREATE',
      p_entity_type: 'sage_payslip_upload',
      p_entity_id: company_id,
      p_details: JSON.stringify({
        filename: filename || file_path.split('/').pop(),
        file_path,
        matched_count: matched.length,
        unmatched_count: unmatched.length,
        uploaded_by: user.id,
      }),
    })

    return json({ matched, unmatched, skipped, total_parsed: parsed.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder('latin1').decode(bytes)

  const streamBlocks: { start: number; end: number; compressed: boolean }[] = []
  let searchPos = 0
  while (searchPos < raw.length) {
    const si = raw.indexOf('stream', searchPos)
    if (si === -1) break
    let contentStart = si + 6
    if (raw.charCodeAt(contentStart) === 13) contentStart++
    if (raw.charCodeAt(contentStart) === 10) contentStart++

    const ei = raw.indexOf('endstream', contentStart)
    if (ei === -1) break

    const dictStart = raw.lastIndexOf('<<', si)
    const dictSlice = dictStart >= 0 ? raw.slice(dictStart, si) : ''
    const compressed = /\/FlateDecode/.test(dictSlice)

    streamBlocks.push({ start: contentStart, end: ei, compressed })
    searchPos = ei + 9
  }

  const pageTexts: string[] = []

  for (const block of streamBlocks) {
    const streamBytes = bytes.slice(block.start, block.end)
    let content: string

    if (block.compressed) {
      try {
        const ds = new DecompressionStream('deflate')
        const writer = ds.writable.getWriter()
        writer.write(streamBytes)
        writer.close()
        const reader = ds.readable.getReader()
        const chunks: Uint8Array[] = []
        let totalLen = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          totalLen += value.length
        }
        const result = new Uint8Array(totalLen)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.length
        }
        content = new TextDecoder('latin1').decode(result)
      } catch {
        continue
      }
    } else {
      content = new TextDecoder('latin1').decode(streamBytes)
    }

    if (!content.includes('BT')) continue

    const lines: { y: number; x: number; text: string }[] = []
    let curX = 0, curY = 0
    const btBlocks = content.split(/\bBT\b/)

    for (let i = 1; i < btBlocks.length; i++) {
      const btContent = btBlocks[i].split(/\bET\b/)[0]
      if (!btContent) continue

      const ops = btContent.split('\n')
      for (const op of ops) {
        const trimmed = op.trim()
        if (!trimmed) continue

        const tdMatch = trimmed.match(/^([-\d.]+)\s+([-\d.]+)\s+Td$/i)
        if (tdMatch) {
          curX += parseFloat(tdMatch[1])
          curY += parseFloat(tdMatch[2])
          continue
        }

        const tmMatch = trimmed.match(/^[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s+Tm$/i)
        if (tmMatch) {
          curX = parseFloat(tmMatch[1])
          curY = parseFloat(tmMatch[2])
          continue
        }

        if (trimmed === 'T*') {
          curY -= 12
          continue
        }

        const tjMatch = trimmed.match(/^\((.+)\)\s*Tj$/s)
        if (tjMatch) {
          lines.push({ y: Math.round(curY), x: Math.round(curX), text: decodePdfString(tjMatch[1]) })
          continue
        }

        const tjArrMatch = trimmed.match(/^\[(.+)\]\s*TJ$/s)
        if (tjArrMatch) {
          const parts: string[] = []
          const itemRe = /\(([^)]*)\)|(-?\d+(?:\.\d+)?)/g
          let m
          while ((m = itemRe.exec(tjArrMatch[1])) !== null) {
            if (m[1] !== undefined) parts.push(decodePdfString(m[1]))
            else if (m[2] !== undefined) {
              const kern = parseFloat(m[2])
              if (kern < -100) parts.push(' ')
            }
          }
          if (parts.length) {
            lines.push({ y: Math.round(curY), x: Math.round(curX), text: parts.join('') })
          }
          continue
        }

        const quoteMatch = trimmed.match(/^\((.+)\)\s*'$/s)
        if (quoteMatch) {
          curY -= 12
          lines.push({ y: Math.round(curY), x: Math.round(curX), text: decodePdfString(quoteMatch[1]) })
        }
      }
    }

    if (lines.length === 0) continue

    lines.sort((a, b) => b.y - a.y || a.x - b.x)

    const output: string[] = []
    let lastY = lines[0]?.y
    for (const line of lines) {
      if (lastY !== undefined && Math.abs(line.y - lastY) > 2) {
        output.push('\n')
      } else if (output.length > 0 && output[output.length - 1] !== '\n') {
        output.push(' ')
      }
      output.push(line.text)
      lastY = line.y
    }
    pageTexts.push(output.join('').trim())
  }

  return pageTexts.filter(Boolean).join('\n==========================================================\n')
}

function decodePdfString(s: string): string {
  return s.replace(/\\([nrtbf\\()]|\d{1,3})/g, (_: string, c: string) => {
    switch (c) {
      case 'n': return '\n'
      case 'r': return '\r'
      case 't': return '\t'
      case 'b': return '\b'
      case 'f': return '\f'
      case '\\': return '\\'
      case '(': return '('
      case ')': return ')'
      default: return String.fromCharCode(parseInt(c, 8))
    }
  })
}
