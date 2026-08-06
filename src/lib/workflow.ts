import { supabase } from './supabase'

export async function getManagerEmail(employeeId: string | null, fallbackEmail: string): Promise<string> {
  if (!employeeId) return fallbackEmail
  const { data: emp } = await supabase
    .from('employees')
    .select('manager_id, manager_email')
    .eq('id', employeeId)
    .single()
  if (!emp) return fallbackEmail

  // Priority 1: manager_id FK — look up that employee's email
  if (emp.manager_id) {
    const { data: mgr } = await supabase
      .from('employees')
      .select('email')
      .eq('id', emp.manager_id)
      .single()
    if (mgr?.email) return mgr.email
  }

  // Priority 2: manager_email text field (set during onboarding)
  if (emp.manager_email) return emp.manager_email

  return fallbackEmail
}
