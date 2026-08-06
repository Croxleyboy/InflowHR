-- 1. Update is_super_admin() to include break glass account
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT email IN ('andy.jones@kumonix.com', 'breakglass@kumonic.com')
    FROM auth.users
    WHERE id = auth.uid()
  );
END;
$$;

-- 2. Robust ensure_company_user:
--    - Claims orphaned company_users rows (onboarding sets employee_id but not auth_user_id)
--    - Matches employees by local part when SSO email differs from onboarded email
--    - Re-resolves employee_id on every login if still null
--    - Syncs role from employees.is_admin flag
CREATE OR REPLACE FUNCTION public.ensure_company_user()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_local_part text;
  v_domain text;
  v_company_id uuid;
  v_employee_id uuid;
  v_cu_id bigint;
  v_role text;
  v_login_disabled boolean;
  v_is_admin boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'Not authenticated');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  v_domain := split_part(v_email, '@', 2);
  v_local_part := lower(split_part(v_email, '@', 1));

  -- =========================================================
  -- A. Check for existing company_users row linked to this auth user
  -- =========================================================
  SELECT id, company_id, role, employee_id
    INTO v_cu_id, v_company_id, v_role, v_employee_id
  FROM company_users
  WHERE auth_user_id = v_user_id AND is_active = true
  LIMIT 1;

  IF v_cu_id IS NOT NULL THEN
    -- Re-resolve employee_id if still null
    IF v_employee_id IS NULL THEN
      SELECT id INTO v_employee_id
      FROM employees
      WHERE company_id = v_company_id
        AND (lower(email) = lower(v_email) OR lower(split_part(email, '@', 1)) = v_local_part)
      LIMIT 1;

      IF v_employee_id IS NOT NULL THEN
        UPDATE company_users SET employee_id = v_employee_id WHERE id = v_cu_id;
      END IF;
    END IF;

    -- Sync role from is_admin flag
    IF v_employee_id IS NOT NULL THEN
      SELECT is_admin INTO v_is_admin FROM employees WHERE id = v_employee_id;
      IF v_is_admin = true AND v_role <> 'admin' THEN
        v_role := 'admin';
        UPDATE company_users SET role = 'admin' WHERE id = v_cu_id;
      END IF;
    END IF;

    SELECT login_disabled INTO v_login_disabled FROM companies WHERE id = v_company_id;
    IF v_login_disabled = true THEN
      RETURN json_build_object('error', 'Login disabled for this company');
    END IF;
    RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
  END IF;

  -- =========================================================
  -- B. No row by auth_user_id — find company by domain
  -- =========================================================
  SELECT id INTO v_company_id
  FROM companies
  WHERE lower(domain) = lower(v_domain) AND is_active = true AND login_disabled = false;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('error', 'No matching company');
  END IF;

  -- =========================================================
  -- C. Find matching employee — exact email then local-part
  -- =========================================================
  SELECT id INTO v_employee_id
  FROM employees
  WHERE lower(email) = lower(v_email) AND company_id = v_company_id;

  IF v_employee_id IS NULL THEN
    SELECT id INTO v_employee_id
    FROM employees
    WHERE lower(split_part(email, '@', 1)) = v_local_part AND company_id = v_company_id
    LIMIT 1;
  END IF;

  -- Determine role from is_admin flag
  v_role := 'employee';
  IF v_employee_id IS NOT NULL THEN
    SELECT CASE WHEN is_admin THEN 'admin' ELSE 'employee' END INTO v_role
    FROM employees WHERE id = v_employee_id;
  END IF;

  -- =========================================================
  -- D. Claim orphaned company_users row (onboarding created with null auth_user_id)
  -- =========================================================
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

  -- =========================================================
  -- E. No orphan — insert new row
  -- =========================================================
  INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
  VALUES (v_user_id, v_company_id, v_employee_id, v_role, true)
  ON CONFLICT (auth_user_id, company_id) DO UPDATE
    SET employee_id = COALESCE(EXCLUDED.employee_id, company_users.employee_id),
        role = CASE WHEN EXCLUDED.employee_id IS NOT NULL THEN EXCLUDED.role ELSE company_users.role END
  RETURNING id INTO v_cu_id;

  RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_company_user() TO authenticated;
