-- ============================================================
-- 025: Add login_disabled column + delete_company_data RPC
-- ============================================================

-- 1. Add login_disabled column to companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS login_disabled boolean NOT NULL DEFAULT false;

-- 2. Update handle_new_sso_user to block login when login_disabled = true
CREATE OR REPLACE FUNCTION handle_new_sso_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id text;
  v_domain text;
  v_company_id uuid;
  v_email text;
  v_is_first_user boolean;
BEGIN
  v_email := NEW.email;
  v_domain := split_part(v_email, '@', 2);

  v_tenant_id := COALESCE(
    NEW.raw_user_meta_data -> 'custom_claims' ->> 'tid',
    NEW.raw_app_meta_data ->> 'provider_id'
  );

  SELECT id INTO v_company_id
  FROM companies
  WHERE domain = v_domain AND is_active = true AND login_disabled = false;

  IF v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_tenant_id IS NOT NULL AND v_tenant_id != '' THEN
    UPDATE companies
    SET microsoft_tenant_id = v_tenant_id
    WHERE id = v_company_id
      AND (microsoft_tenant_id IS NULL OR microsoft_tenant_id = '' OR microsoft_tenant_id = 'placeholder-tenant-id');
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM company_users WHERE company_id = v_company_id
  ) INTO v_is_first_user;

  INSERT INTO company_users (auth_user_id, company_id, role)
  VALUES (
    NEW.id,
    v_company_id,
    CASE WHEN v_is_first_user THEN 'admin' ELSE 'employee' END
  )
  ON CONFLICT (auth_user_id, company_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 3. Update ensure_company_user to check login_disabled
CREATE OR REPLACE FUNCTION public.ensure_company_user()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_domain text;
  v_company_id uuid;
  v_employee_id uuid;
  v_cu_id bigint;
  v_role text;
  v_login_disabled boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'Not authenticated');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  v_domain := split_part(v_email, '@', 2);

  SELECT id, company_id, role, employee_id INTO v_cu_id, v_company_id, v_role, v_employee_id
  FROM company_users
  WHERE auth_user_id = v_user_id AND is_active = true
  LIMIT 1;

  IF v_cu_id IS NOT NULL THEN
    SELECT login_disabled INTO v_login_disabled FROM companies WHERE id = v_company_id;
    IF v_login_disabled = true THEN
      RETURN json_build_object('error', 'Login disabled for this company');
    END IF;
    RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
  END IF;

  SELECT id INTO v_company_id
  FROM companies
  WHERE domain = v_domain AND is_active = true AND login_disabled = false;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('error', 'No matching company');
  END IF;

  SELECT id INTO v_employee_id
  FROM employees
  WHERE email = v_email AND company_id = v_company_id;

  v_role := 'employee';
  IF v_employee_id IS NOT NULL THEN
    SELECT CASE WHEN is_admin THEN 'admin' ELSE 'employee' END INTO v_role
    FROM employees WHERE id = v_employee_id;
  END IF;

  INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
  VALUES (v_user_id, v_company_id, v_employee_id, v_role, true)
  ON CONFLICT (auth_user_id, company_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, role = EXCLUDED.role
  RETURNING id INTO v_cu_id;

  RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
END;
$$;

-- 4. RPC to delete all data for a specific company
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
