import { getSupabase, getValidXeroToken, corsHeaders, json } from '../_shared/xero.ts'

const XERO_PAYROLL_UK = 'https://api.xero.com/payroll.xro/1.0'
const XERO_PAYROLL_AU = 'https://api.xero.com/payroll.xro/2.0'

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

    const { company_id } = await req.json()
    if (!company_id) return json({ error: 'company_id required' }, 400)

    const { data: cu } = await sb
      .from('company_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .eq('company_id', company_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!cu || (cu.role !== 'admin' && cu.role !== 'hr')) return json({ error: 'Access denied' }, 403)

    const creds = await getValidXeroToken(company_id)
    if (!creds) return json({ error: 'Xero not connected — please connect first' }, 400)

    const result = await syncXeroEmployees(sb, creds, company_id)
    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

async function syncXeroEmployees(
  sb: ReturnType<typeof getSupabase>,
  creds: { accessToken: string; tenantId: string },
  companyId: string,
) {
  const headers = {
    Authorization: `Bearer ${creds.accessToken}`,
    'xero-tenant-id': creds.tenantId,
    Accept: 'application/json',
  }

  let baseUrl = XERO_PAYROLL_UK
  const testRes = await fetch(`${baseUrl}/PayRuns`, { headers })
  if (!testRes.ok) {
    const errText = await testRes.text()
    if (errText.includes('AU Customer') || errText.includes('ValidationException')) {
      baseUrl = XERO_PAYROLL_AU
    } else {
      return { error: 'Failed to connect to Xero Payroll API' }
    }
  }

  const xeroEmployees: { xeroId: string; email: string; firstName: string; lastName: string }[] = []
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
      const firstName = e.FirstName || e.firstName || ''
      const lastName = e.LastName || e.lastName || ''
      if (eId && eEmail) {
        xeroEmployees.push({ xeroId: eId, email: eEmail, firstName, lastName })
      }
    }
    if (employees.length < 100) break
    empPage++
  }

  if (!xeroEmployees.length) {
    return { matched: 0, unmatched: 0, xero_total: 0, details: [] }
  }

  const { data: inflowEmployees } = await sb
    .from('employees')
    .select('id, email, first_name, last_name, xero_employee_id')
    .eq('company_id', companyId)

  const emailToInflow: Record<string, { id: string; name: string; alreadyLinked: boolean }> = {}
  for (const e of (inflowEmployees || [])) {
    if (e.email) {
      emailToInflow[e.email.toLowerCase()] = {
        id: e.id,
        name: `${e.first_name} ${e.last_name}`,
        alreadyLinked: !!e.xero_employee_id,
      }
    }
  }

  const details: { xero_name: string; xero_email: string; status: string; inflow_name?: string }[] = []
  let matched = 0
  let alreadyLinked = 0

  for (const xe of xeroEmployees) {
    const inflow = emailToInflow[xe.email]
    if (!inflow) {
      details.push({
        xero_name: `${xe.firstName} ${xe.lastName}`,
        xero_email: xe.email,
        status: 'unmatched',
      })
      continue
    }

    if (inflow.alreadyLinked) {
      alreadyLinked++
      details.push({
        xero_name: `${xe.firstName} ${xe.lastName}`,
        xero_email: xe.email,
        status: 'already_linked',
        inflow_name: inflow.name,
      })
      continue
    }

    await sb.from('employees').update({ xero_employee_id: xe.xeroId }).eq('id', inflow.id)
    matched++
    details.push({
      xero_name: `${xe.firstName} ${xe.lastName}`,
      xero_email: xe.email,
      status: 'linked',
      inflow_name: inflow.name,
    })
  }

  const unmatched = details.filter(d => d.status === 'unmatched').length

  await sb.from('payroll_audit_log').insert({
    company_id: companyId,
    action: 'Xero Employee Sync',
    detail: `Synced Xero employees — Linked: ${matched}, Already linked: ${alreadyLinked}, Unmatched: ${unmatched}, Total in Xero: ${xeroEmployees.length}`,
    status: 'success',
  })

  return {
    matched,
    already_linked: alreadyLinked,
    unmatched,
    xero_total: xeroEmployees.length,
    details,
  }
}
