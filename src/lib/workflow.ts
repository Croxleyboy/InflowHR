import { supabase } from './supabase'
import { toLocalDateStr } from './formatters'

export async function getManagerEmail(employeeId: string | null, fallbackEmail: string, scope?: 'leave' | 'expenses' | 'timesheets'): Promise<string> {
  if (!employeeId) return fallbackEmail
  const { data: emp } = await supabase
    .from('employees')
    .select('manager_id, manager_email, company_id')
    .eq('id', employeeId)
    .single()
  if (!emp) return fallbackEmail

  let managerEmail: string | null = null
  let managerId: string | null = emp.manager_id || null

  // Priority 1: manager_email text field (explicitly set by admin)
  if (emp.manager_email) {
    managerEmail = emp.manager_email
    if (!managerId && emp.company_id) {
      const { data: mgrByEmail } = await supabase
        .from('employees')
        .select('id')
        .eq('email', emp.manager_email)
        .eq('company_id', emp.company_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (mgrByEmail) managerId = mgrByEmail.id
    }
  }

  // Priority 2: manager_id FK — look up that employee's email (skip inactive/frozen)
  if (!managerEmail && emp.manager_id) {
    const { data: mgr } = await supabase
      .from('employees')
      .select('email, is_active')
      .eq('id', emp.manager_id)
      .single()
    if (mgr?.email && mgr.is_active !== false) managerEmail = mgr.email
  }

  // Priority 3: find a company admin to assign to
  if (!managerEmail && emp.company_id) {
    const { data: admins } = await supabase
      .from('company_users')
      .select('auth_user_id')
      .eq('company_id', emp.company_id)
      .eq('role', 'admin')
      .limit(5)
    if (admins && admins.length > 0) {
      const adminIds = admins.map(a => a.auth_user_id).filter(Boolean)
      if (adminIds.length > 0) {
        const { data: adminEmps } = await supabase
          .from('employees')
          .select('email')
          .in('auth_user_id', adminIds)
          .neq('id', employeeId)
          .limit(1)
        if (adminEmps?.[0]?.email) managerEmail = adminEmps[0].email
      }
    }
  }

  if (!managerEmail) return fallbackEmail

  // Check for active approval delegation covering today
  if (scope && emp.company_id && managerId) {
    const today = toLocalDateStr()
    const { data: delegation } = await supabase
      .from('approval_delegations')
      .select('delegate_id, scope')
      .eq('delegator_id', managerId)
      .eq('company_id', emp.company_id)
      .eq('is_active', true)
      .lte('start_date', today)
      .gte('end_date', today)
      .limit(1)
      .maybeSingle()
    if (delegation) {
      const delScope = delegation.scope || 'all'
      if (delScope === 'all' || delScope.split(',').map((s: string) => s.trim()).includes(scope)) {
        const { data: delegate } = await supabase
          .from('employees')
          .select('email, is_active')
          .eq('id', delegation.delegate_id)
          .single()
        if (delegate?.email && delegate.is_active !== false) return delegate.email
      }
    }
  }

  return managerEmail
}

export async function getNameByEmail(email: string, companyId?: string): Promise<string> {
  const query = supabase.from('employees').select('first_name, last_name').eq('email', email).eq('is_active', true)
  if (companyId) query.eq('company_id', companyId)
  const { data } = await query.limit(1).maybeSingle()
  if (data?.first_name) return `${data.first_name} ${data.last_name || ''}`.trim()
  return email.split('@')[0]
}
