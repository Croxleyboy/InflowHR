import { supabase } from './supabase'

export async function isTwoStepEnabled(companyId: string): Promise<boolean> {
  const { data } = await supabase
    .from('companies')
    .select('two_step_approvals_enabled')
    .eq('id', companyId)
    .single()
  return data?.two_step_approvals_enabled === true
}

export async function createApprovalRecord(params: {
  companyId: string
  category: 'legal_timesheet' | 'timesheet' | 'shift_rota' | 'access_request' | 'payroll_month'
  action: 'delete' | 'revoke'
  recordId: string
  recordSummary: Record<string, unknown>
  userId: string
  userName: string
}): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('admin_approvals').insert({
    company_id: params.companyId,
    category: params.category,
    action: params.action,
    record_id: params.recordId,
    record_summary: params.recordSummary,
    requested_by: params.userId,
    requester_name: params.userName,
  })
  if (error) return { success: false, error: error.message }
  return { success: true }
}
