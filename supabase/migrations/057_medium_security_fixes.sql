-- ============================================================
-- 057: MEDIUM severity security fixes
--
-- SEC-15: Fix ensure_company_user local-part admin escalation
-- SEC-18: Add GDPR audit logging to ensure_super_admin_access
-- SEC-20: Automated data retention enforcement
-- SEC-24: Fix get_my_company_id() deterministic ordering
-- ============================================================


-- ============================================================
-- SEC-15: ensure_company_user — use full email match before
-- falling back to local-part, and never auto-grant admin
-- from local-part match alone
-- ============================================================

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
  v_matched_by_local_part boolean := false;
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
    IF v_employee_id IS NULL THEN
      -- Try exact email first
      SELECT id INTO v_employee_id
      FROM employees
      WHERE company_id = v_company_id AND lower(email) = lower(v_email)
      LIMIT 1;

      -- Fall back to local-part match only if exact email didn't match
      IF v_employee_id IS NULL THEN
        SELECT id INTO v_employee_id
        FROM employees
        WHERE company_id = v_company_id AND lower(split_part(email, '@', 1)) = v_local_part
        LIMIT 1;
        IF v_employee_id IS NOT NULL THEN
          v_matched_by_local_part := true;
        END IF;
      END IF;

      IF v_employee_id IS NOT NULL THEN
        UPDATE company_users SET employee_id = v_employee_id WHERE id = v_cu_id;
      END IF;
    END IF;

    -- Sync role from is_admin flag, but NOT if matched by local-part only
    IF v_employee_id IS NOT NULL AND NOT v_matched_by_local_part THEN
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
  -- C. Find matching employee — exact email first, then local-part
  -- =========================================================
  SELECT id INTO v_employee_id
  FROM employees
  WHERE lower(email) = lower(v_email) AND company_id = v_company_id;

  IF v_employee_id IS NULL THEN
    SELECT id INTO v_employee_id
    FROM employees
    WHERE lower(split_part(email, '@', 1)) = v_local_part AND company_id = v_company_id
    LIMIT 1;
    IF v_employee_id IS NOT NULL THEN
      v_matched_by_local_part := true;
    END IF;
  END IF;

  -- Determine role: only grant admin if matched by full email, not local-part
  v_role := 'employee';
  IF v_employee_id IS NOT NULL AND NOT v_matched_by_local_part THEN
    SELECT CASE WHEN is_admin THEN 'admin' ELSE 'employee' END INTO v_role
    FROM employees WHERE id = v_employee_id;
  END IF;

  -- =========================================================
  -- D. Claim orphaned company_users row
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


-- ============================================================
-- SEC-18: Add GDPR audit logging to ensure_super_admin_access
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_super_admin_access(p_hours int DEFAULT 48)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sa_uid uuid;
  v_count  integer := 0;
  v_company record;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can call this function';
  END IF;

  v_sa_uid := auth.uid();

  -- Expire any stale grants first
  UPDATE tenant_support_access
    SET status = 'expired'
  WHERE status = 'active' AND expires_at < now();

  -- Create grants for companies without active access and log each one
  FOR v_company IN
    SELECT c.id
    FROM companies c
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant_support_access t
      WHERE t.company_id = c.id
        AND t.granted_to = v_sa_uid
        AND t.status = 'active'
        AND t.expires_at > now()
    )
  LOOP
    INSERT INTO tenant_support_access (
      company_id, granted_by, granted_to, reason, scope, expires_at
    ) VALUES (
      v_company.id,
      v_sa_uid,
      v_sa_uid,
      'Platform maintenance — auto-granted',
      'full',
      now() + (p_hours || ' hours')::interval
    );

    PERFORM log_gdpr_action(
      v_company.id, 'tenant_support_access', v_company.id::text, 'SELF_GRANT_ACCESS',
      NULL, NULL, NULL,
      jsonb_build_object('granted_by', v_sa_uid, 'hours', p_hours, 'reason', 'Platform maintenance — auto-granted')
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


-- ============================================================
-- SEC-24: Fix get_my_company_id() — add ORDER BY for determinism
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT company_id
  FROM company_users
  WHERE auth_user_id = auth.uid()
    AND is_active = true
  ORDER BY created_at
  LIMIT 1;
$$;


-- ============================================================
-- SEC-20: Automated data retention — function to purge expired
-- frozen employees (call via pg_cron or Edge Function daily)
-- ============================================================

CREATE OR REPLACE FUNCTION purge_expired_frozen_employees()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record record;
  v_count integer := 0;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can call this function';
  END IF;

  FOR v_record IN
    SELECT id, employee_id, company_id, employee_name
    FROM frozen_employees
    WHERE deletion_date <= now()
  LOOP
    PERFORM log_gdpr_action(
      v_record.company_id, 'frozen_employees', v_record.id::text, 'AUTO_PURGE',
      NULL, NULL, NULL,
      jsonb_build_object('employee_name', v_record.employee_name, 'reason', 'Retention period expired')
    );

    DELETE FROM frozen_employees WHERE id = v_record.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION purge_expired_frozen_employees() TO authenticated;
