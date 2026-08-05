-- Add missing tables to delete_company_data RPC
CREATE OR REPLACE FUNCTION public.delete_company_data(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;

  ALTER TABLE one_to_one_comments DISABLE ROW LEVEL SECURITY;
  ALTER TABLE one_to_one_meetings DISABLE ROW LEVEL SECURITY;

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

GRANT EXECUTE ON FUNCTION public.delete_company_data(uuid) TO authenticated;
