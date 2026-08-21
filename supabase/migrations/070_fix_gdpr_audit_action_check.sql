-- Add SELF_GRANT_ACCESS to the allowed actions in gdpr_audit_logs
-- The ensure_super_admin_access RPC logs with this action but it was missing from the constraint
ALTER TABLE gdpr_audit_logs DROP CONSTRAINT IF EXISTS gdpr_audit_logs_action_check;
ALTER TABLE gdpr_audit_logs ADD CONSTRAINT gdpr_audit_logs_action_check
  CHECK (action IN (
    'SELECT', 'INSERT', 'UPDATE', 'DELETE',
    'EXPORT', 'ANONYMISE', 'GRANT_ACCESS', 'REVOKE_ACCESS',
    'SELF_GRANT_ACCESS'
  ));

-- Grant support access for a single company (used on company creation)
CREATE OR REPLACE FUNCTION grant_support_access_for_company(
  p_company_id uuid,
  p_hours int DEFAULT 48
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sa_uid uuid;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can call this function';
  END IF;

  v_sa_uid := auth.uid();

  INSERT INTO tenant_support_access (
    company_id, granted_by, granted_to, reason, scope, expires_at
  ) VALUES (
    p_company_id,
    v_sa_uid,
    v_sa_uid,
    'Auto-granted on company creation',
    'full',
    now() + (p_hours || ' hours')::interval
  );
END;
$$;

GRANT EXECUTE ON FUNCTION grant_support_access_for_company(uuid, int) TO authenticated;

-- Update delete_company_data to clean up gdpr_audit_logs and tenant_support_access
CREATE OR REPLACE FUNCTION public.delete_company_data(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_name text;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;

  ALTER TABLE one_to_one_comments DISABLE ROW LEVEL SECURITY;
  ALTER TABLE one_to_one_meetings DISABLE ROW LEVEL SECURITY;

  DELETE FROM gdpr_audit_logs           WHERE company_id = p_company_id;
  DELETE FROM tenant_support_access     WHERE company_id = p_company_id;
  DELETE FROM benefit_enrollments       WHERE company_id = p_company_id;
  DELETE FROM benefit_options           WHERE company_id = p_company_id;
  DELETE FROM benefit_types             WHERE company_id = p_company_id;
  DELETE FROM shift_swap_requests       WHERE company_id = p_company_id;
  DELETE FROM shift_assignments         WHERE company_id = p_company_id;
  DELETE FROM shift_templates           WHERE company_id = p_company_id;
  DELETE FROM rotas                     WHERE company_id = p_company_id;
  DELETE FROM employee_availability     WHERE company_id = p_company_id;
  DELETE FROM legal_timesheet_entries   WHERE company_id = p_company_id;
  DELETE FROM legal_matters             WHERE company_id = p_company_id;
  DELETE FROM legal_clients             WHERE company_id = p_company_id;
  DELETE FROM hr_tickets                WHERE company_id = p_company_id;

  DELETE FROM one_to_one_comments WHERE company_id = p_company_id;
  DELETE FROM one_to_one_meetings WHERE company_id = p_company_id;
  DELETE FROM workflow_tracker     WHERE company_id = p_company_id;
  DELETE FROM notifications        WHERE company_id = p_company_id;
  DELETE FROM timesheets           WHERE company_id = p_company_id;
  DELETE FROM expense_line_items   WHERE company_id = p_company_id;
  DELETE FROM expense_claims       WHERE company_id = p_company_id;
  DELETE FROM leave_requests       WHERE company_id = p_company_id;
  DELETE FROM leave_balances       WHERE company_id = p_company_id;
  DELETE FROM course_enrolments    WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id);
  DELETE FROM employee_benefits    WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id);
  DELETE FROM performance_reviews  WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id);
  DELETE FROM kudos                WHERE company_id = p_company_id;
  DELETE FROM payslips             WHERE company_id = p_company_id;
  DELETE FROM onboarding           WHERE company_id = p_company_id;
  DELETE FROM announcements        WHERE company_id = p_company_id;
  DELETE FROM user_settings        WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id);
  DELETE FROM app_settings         WHERE company_id = p_company_id;
  DELETE FROM company_features     WHERE company_id = p_company_id;
  DELETE FROM company_elearning_courses WHERE company_id = p_company_id;
  DELETE FROM benefits             WHERE company_id = p_company_id;
  DELETE FROM courses              WHERE company_id = p_company_id;
  DELETE FROM company_users        WHERE company_id = p_company_id;
  DELETE FROM employees            WHERE company_id = p_company_id;
  DELETE FROM leave_types          WHERE company_id = p_company_id;
  DELETE FROM companies            WHERE id = p_company_id;

  ALTER TABLE one_to_one_meetings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE one_to_one_comments ENABLE ROW LEVEL SECURITY;

  RETURN 'Deleted all data for company: ' || v_company_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_company_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_company_data(uuid) TO authenticated;
