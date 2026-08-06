-- Fix ensure_company_user to claim orphaned company_users rows
-- (created during onboarding with employee_id but no auth_user_id)
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

  -- Check for existing company_users row linked to this auth user
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

  -- No row by auth_user_id — find company by domain
  SELECT id INTO v_company_id
  FROM companies
  WHERE domain = v_domain AND is_active = true AND login_disabled = false;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('error', 'No matching company');
  END IF;

  -- Find matching employee
  SELECT id INTO v_employee_id
  FROM employees
  WHERE email = v_email AND company_id = v_company_id;

  v_role := 'employee';
  IF v_employee_id IS NOT NULL THEN
    SELECT CASE WHEN is_admin THEN 'admin' ELSE 'employee' END INTO v_role
    FROM employees WHERE id = v_employee_id;
  END IF;

  -- Check for an orphaned company_users row (created by onboarding with no auth_user_id)
  IF v_employee_id IS NOT NULL THEN
    SELECT id INTO v_cu_id
    FROM company_users
    WHERE employee_id = v_employee_id AND company_id = v_company_id AND auth_user_id IS NULL
    LIMIT 1;

    IF v_cu_id IS NOT NULL THEN
      UPDATE company_users
      SET auth_user_id = v_user_id, role = v_role, is_active = true
      WHERE id = v_cu_id;
      RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
    END IF;
  END IF;

  -- No orphan found — insert new row
  INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
  VALUES (v_user_id, v_company_id, v_employee_id, v_role, true)
  ON CONFLICT (auth_user_id, company_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, role = EXCLUDED.role
  RETURNING id INTO v_cu_id;

  RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_company_user() TO authenticated;
