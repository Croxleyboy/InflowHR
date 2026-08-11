import { supabase } from './supabase'

export async function getManagerEmail(employeeId: string | null, fallbackEmail: string): Promise<string> {
  if (!employeeId) return fallbackEmail
  const { data: emp } = await supabase
    .from('employees')
    .select('manager_id, manager_email, company_id')
    .eq('id', employeeId)
    .single()
  if (!emp) return fallbackEmail

  // Priority 1: manager_email text field (explicitly set by admin)
  if (emp.manager_email) return emp.manager_email

  // Priority 2: manager_id FK — look up that employee's email
  if (emp.manager_id) {
    const { data: mgr } = await supabase
      .from('employees')
      .select('email')
      .eq('id', emp.manager_id)
      .single()
    if (mgr?.email) return mgr.email
  }

  // Priority 3: find a company admin to assign to
  if (emp.company_id) {
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
        if (adminEmps?.[0]?.email) return adminEmps[0].email
      }
    }
  }

  return fallbackEmail
}
