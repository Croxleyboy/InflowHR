-- ============================================================
-- 055: Critical security fixes
--
-- SEC-01: delete_company_data — add is_super_admin() guard
-- SEC-02: promote_employee_to_admin — revoke anon, add admin guard
-- SEC-03: elearning_courses — replace open write policy
-- ============================================================

-- ============================================================
-- SEC-01: delete_company_data
--
-- The RPC is SECURITY DEFINER so it bypasses RLS. Currently any
-- authenticated user can call it with any company_id and wipe
-- that company. Add an explicit is_super_admin() check.
-- The AdminCompanies page (behind SuperAdminGate) is the only
-- caller, so no functionality changes.
-- ============================================================
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

-- Keep grant to authenticated (the function now self-guards)
REVOKE EXECUTE ON FUNCTION public.delete_company_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_company_data(uuid) TO authenticated;


-- ============================================================
-- SEC-02: promote_employee_to_admin
--
-- Revoke anon grant. Add check that the caller is an admin of
-- the target company (or super admin). The only caller is the
-- admin employees page which is already behind AdminGate.
-- ============================================================
CREATE OR REPLACE FUNCTION public.promote_employee_to_admin(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_auth_user_id uuid;
  v_cu_id uuid;
BEGIN
  -- Only company admins or super admins can promote
  IF NOT is_super_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM company_users
      WHERE auth_user_id = auth.uid()
        AND company_id = p_company_id
        AND is_active = true
        AND role IN ('admin', 'hr')
    ) THEN
      RAISE EXCEPTION 'Access denied: company admin required';
    END IF;
  END IF;

  SELECT email INTO v_email
  FROM employees
  WHERE id = p_employee_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE email = v_email;

  IF v_auth_user_id IS NOT NULL THEN
    SELECT id INTO v_cu_id
    FROM company_users
    WHERE auth_user_id = v_auth_user_id
      AND company_id = p_company_id;

    IF v_cu_id IS NOT NULL THEN
      UPDATE company_users
      SET role = 'admin', employee_id = p_employee_id
      WHERE id = v_cu_id;
      RETURN;
    END IF;

    INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
    VALUES (v_auth_user_id, p_company_id, p_employee_id, 'admin', true)
    ON CONFLICT (auth_user_id, company_id)
    DO UPDATE SET role = 'admin', employee_id = p_employee_id;
    RETURN;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_employee_to_admin(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.promote_employee_to_admin(uuid, uuid) TO authenticated;


-- ============================================================
-- SEC-03: elearning_courses — multi-tier access model
--
-- Core courses (company_id IS NULL): super admin CRUD
-- Company courses (company_id set): company admin CRUD for own company
-- All authenticated users can read core courses + own company courses
--
-- Department targeting via target_departments on company_elearning_courses
-- ============================================================

-- Add company_id to elearning_courses (NULL = core, non-NULL = company-specific)
ALTER TABLE elearning_courses ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;

-- Add department targeting to company_elearning_courses
ALTER TABLE company_elearning_courses ADD COLUMN IF NOT EXISTS target_departments text[] NOT NULL DEFAULT '{}';

-- Drop the overly permissive policies
DROP POLICY IF EXISTS "elearning_courses_read" ON elearning_courses;
DROP POLICY IF EXISTS "elearning_courses_write" ON elearning_courses;

-- Authenticated users can read core courses (company_id IS NULL) and
-- courses belonging to their own company
CREATE POLICY "elearning_courses_authenticated_read"
  ON elearning_courses FOR SELECT
  TO authenticated
  USING (company_id IS NULL OR company_id = get_my_company_id() OR is_super_admin());

-- Super admin can insert core courses (company_id IS NULL);
-- company admins can insert courses for their own company
CREATE POLICY "elearning_courses_insert"
  ON elearning_courses FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN company_id IS NULL THEN is_super_admin()
      ELSE company_id = get_my_company_id() AND is_company_admin()
    END
  );

-- Super admin can update core courses;
-- company admins can update their own company courses
CREATE POLICY "elearning_courses_update"
  ON elearning_courses FOR UPDATE
  TO authenticated
  USING (
    CASE
      WHEN company_id IS NULL THEN is_super_admin()
      ELSE company_id = get_my_company_id() AND is_company_admin()
    END
  )
  WITH CHECK (
    CASE
      WHEN company_id IS NULL THEN is_super_admin()
      ELSE company_id = get_my_company_id() AND is_company_admin()
    END
  );

-- Super admin can delete core courses;
-- company admins can delete their own company courses
CREATE POLICY "elearning_courses_delete"
  ON elearning_courses FOR DELETE
  TO authenticated
  USING (
    CASE
      WHEN company_id IS NULL THEN is_super_admin()
      ELSE company_id = get_my_company_id() AND is_company_admin()
    END
  );

-- Block anon entirely
CREATE POLICY "elearning_courses_anon_blocked"
  ON elearning_courses FOR SELECT
  TO anon
  USING (false);
