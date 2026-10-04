// GET /functions/v1/xero-callback?code=…&state=…
// Xero redirects here after the user authorises.
// Exchanges the code for tokens, fetches tenant ID, saves to DB,
// then redirects the browser back to the app.

import { getSupabase, getXeroEnv, getValidXeroToken, corsHeaders, redirect, verifyState } from '../_shared/xero.ts'

const TOKEN_URL = 'https://identity.xero.com/connect/token'
const CONNECTIONS_URL = 'https://api.xero.com/connections'
const XERO_PAYROLL_UK = 'https://api.xero.com/payroll.xro/1.0'
const XERO_PAYROLL_AU = 'https://api.xero.com/payroll.xro/2.0'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const stateRaw = url.searchParams.get('state')

    if (!code || !stateRaw) {
      return redirect(getFrontendUrl() + '?xero=error&reason=missing_params')
    }

    const { clientId, clientSecret, redirectUri } = getXeroEnv()

    // Verify HMAC signature on state to prevent forgery
    let companyId: string
    try {
      const verified = await verifyState(stateRaw, clientSecret)
      if (!verified) {
        return redirect(getFrontendUrl() + '?xero=error&reason=invalid_state_signature')
      }
      const parsed = JSON.parse(atob(verified))
      companyId = parsed.company_id
      if (!companyId) throw new Error('no company_id')
    } catch {
      return redirect(getFrontendUrl() + '?xero=error&reason=bad_state')
    }

    // Exchange authorisation code for tokens
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('Token exchange failed:', err)
      return redirect(getFrontendUrl() + '?xero=error&reason=token_exchange')
    }

    const tokens = await tokenRes.json()
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString()

    // Fetch tenant ID from Xero connections
    const connRes = await fetch(CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!connRes.ok) {
      console.error('Connections fetch failed:', await connRes.text())
      return redirect(getFrontendUrl() + '?xero=error&reason=connections')
    }

    const connections = await connRes.json()
    if (!connections.length) {
      return redirect(getFrontendUrl() + '?xero=error&reason=no_tenant')
    }
    // Pick the most recently connected tenant (handles multiple orgs)
    connections.sort((a: { updatedDateUtc: string }, b: { updatedDateUtc: string }) =>
      (b.updatedDateUtc || '').localeCompare(a.updatedDateUtc || '')
    )
    const tenantId = connections[0].tenantId

    // Upsert into xero_integrations (service role bypasses RLS)
    const sb = getSupabase()
    const { error: dbErr } = await sb
      .from('xero_integrations')
      .upsert({
        company_id: companyId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        tenant_id: tenantId,
        expires_at: expiresAt,
        sync_status: 'connected',
        sync_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id' })

    if (dbErr) {
      console.error('DB upsert failed:', dbErr)
      return redirect(getFrontendUrl() + '?xero=error&reason=db')
    }

    // Auto-sync: match Xero employees to InflowHR employees by email
    try {
      await autoSyncEmployees(sb, tokens.access_token, tenantId, companyId)
    } catch {
      // Non-blocking — connection succeeded even if sync fails
    }

    return redirect(getFrontendUrl() + '?xero=connected')
  } catch (err) {
    console.error('xero-callback error:', err)
    return redirect(getFrontendUrl() + '?xero=error&reason=unknown')
  }
})

function getFrontendUrl(): string {
  return Deno.env.get('FRONTEND_URL') || 'https://inflowhr.co.uk/admin/payroll'
}

async function autoSyncEmployees(
  sb: ReturnType<typeof getSupabase>,
  accessToken: string,
  tenantId: string,
  companyId: string,
) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'xero-tenant-id': tenantId,
    Accept: 'application/json',
  }

  // Detect UK vs AU
  let baseUrl = XERO_PAYROLL_UK
  const testRes = await fetch(`${baseUrl}/PayRuns`, { headers })
  if (!testRes.ok) {
    const errText = await testRes.text()
    if (errText.includes('AU Customer') || errText.includes('ValidationException')) {
      baseUrl = XERO_PAYROLL_AU
    } else {
      return
    }
  }

  // Fetch all Xero employees
  const xeroEmployees: { xeroId: string; email: string }[] = []
  let empPage = 1
  while (true) {
    const empRes = await fetch(`${baseUrl}/Employees?page=${empPage}`, { headers })
    if (!empRes.ok) break
    const empData = await empRes.json()
    const employees = empData.Employees || empData.employees || []
    if (!employees.length) break
    for (const e of employees) {
      const eId = e.EmployeeID || e.employeeID
      const eEmail = (e.Email || e.email || '').toLowerCase()
      if (eId && eEmail) xeroEmployees.push({ xeroId: eId, email: eEmail })
    }
    if (employees.length < 100) break
    empPage++
  }

  if (!xeroEmployees.length) return

  // Load InflowHR employees
  const { data: inflowEmployees } = await sb
    .from('employees')
    .select('id, email, xero_employee_id')
    .eq('company_id', companyId)

  const emailToInflowId: Record<string, string> = {}
  const alreadyLinked = new Set<string>()
  for (const e of (inflowEmployees || [])) {
    if (e.email) emailToInflowId[e.email.toLowerCase()] = e.id
    if (e.xero_employee_id) alreadyLinked.add(e.id)
  }

  let matched = 0
  for (const xe of xeroEmployees) {
    const inflowId = emailToInflowId[xe.email]
    if (!inflowId || alreadyLinked.has(inflowId)) continue
    await sb.from('employees').update({ xero_employee_id: xe.xeroId }).eq('id', inflowId)
    matched++
  }

  if (matched > 0) {
    await sb.from('payroll_audit_log').insert({
      company_id: companyId,
      action: 'Xero Employee Auto-Sync',
      detail: `Auto-linked ${matched} employee(s) to Xero by email on connection`,
      status: 'success',
    })
  }
}
