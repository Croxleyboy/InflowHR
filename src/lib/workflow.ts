import { supabase } from './supabase'

export async function getManagerEmail(employeeId: string | null, fallbackEmail: string): Promise<string> {
  if (!employeeId) return fallbackEmail
  const { data: emp } = await supabase
    .from('employees')
    .select('manager_id')
    .eq('id', employeeId)
    .single()
  if (emp?.manager_id) {
    const { data: mgr } = await supabase
      .from('employees')
      .select('email')
      .eq('id', emp.manager_id)
      .single()
    if (mgr?.email) return mgr.email
  }
  return fallbackEmail
}
