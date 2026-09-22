-- Fix duplicate company_users records and prevent future duplicates.
-- Root cause: multiple code paths create company_users rows without checking
-- for existing records by employee_id, and NULL auth_user_id bypasses the
-- UNIQUE(auth_user_id, company_id) constraint.
--
-- CodeRabbit CB-3: use a normal unique constraint (not partial index) so
-- frontend upserts with onConflict('employee_id,company_id') work correctly.
-- CodeRabbit CB-4: add ambiguity guard to local-part fallback in ensure_company_user.

-- 1. Allow auth_user_id to be NULL (onboarding creates rows before user logs in)
ALTER TABLE company_users ALTER COLUMN auth_user_id DROP NOT NULL;

-- 2. Delete duplicate company_users rows, keeping the oldest per (employee_id, company_id)
DELETE FROM company_users
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY employee_id, company_id
             ORDER BY
               CASE WHEN auth_user_id IS NOT NULL THEN 0 ELSE 1 END,
               created_at ASC
           ) AS rn
    FROM company_users
    WHERE employee_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- 3. Set any remaining NULL employee_id rows to a consistent state
-- (needed so the unique constraint doesn't block multiple NULL employee_id rows)
-- NULLs are excluded from unique constraints in PostgreSQL, so this is safe as-is.

-- 4. Add unique constraint on (employee_id, company_id).
-- PostgreSQL unique constraints treat NULLs as distinct, so rows with
-- employee_id IS NULL are not constrained — no partial index needed.
ALTER TABLE company_users
  ADD CONSTRAINT uq_company_users_employee_company
  UNIQUE (employee_id, company_id);

-- 5. Update ensure_company_user with local-part ambiguity guard (CB-4)
CREATE OR REPLACE FUNCTION public.ensure_company_user()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_tenant_id text;
  v_company_id uuid;
  v_employee_id uuid;
  v_cu_id uuid;
  v_role text;
  v_local_part text;
  v_matched_by_local_part boolean := false;
  v_local_part_count int;
BEGIN
  SELECT id, email, raw_app_meta_data ->> 'tenant_id'
  INTO v_user_id, v_email, v_tenant_id
  FROM auth.users
  WHERE id = auth.uid();

  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'not_authenticated');
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    SELECT id INTO v_company_id FROM companies WHERE tenant_id = v_tenant_id;
  END IF;

  IF v_company_id IS NULL THEN
    SELECT company_id INTO v_company_id
    FROM company_users
    WHERE auth_user_id = v_user_id AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('error', 'no_company');
  END IF;

  v_local_part := lower(split_part(v_email, '@', 1));

  -- Try exact email match first
  SELECT id INTO v_employee_id
  FROM employees
  WHERE lower(email) = lower(v_email) AND company_id = v_company_id;

  -- Fallback: local-part match with ambiguity guard (CB-4)
  IF v_employee_id IS NULL THEN
    SELECT count(*) INTO v_local_part_count
    FROM employees
    WHERE lower(split_part(email, '@', 1)) = v_local_part AND company_id = v_company_id;

    IF v_local_part_count = 1 THEN
      SELECT id INTO v_employee_id
      FROM employees
      WHERE lower(split_part(email, '@', 1)) = v_local_part AND company_id = v_company_id;
      v_matched_by_local_part := true;
    END IF;
    -- If v_local_part_count > 1, skip — ambiguous match, don't guess
  END IF;

  v_role := 'employee';
  IF v_employee_id IS NOT NULL AND NOT v_matched_by_local_part THEN
    SELECT CASE WHEN is_admin THEN 'admin' ELSE 'employee' END INTO v_role
    FROM employees WHERE id = v_employee_id;
  END IF;

  -- Check for existing company_users row linked to this auth user
  SELECT id INTO v_cu_id
  FROM company_users
  WHERE auth_user_id = v_user_id AND company_id = v_company_id
  LIMIT 1;

  IF v_cu_id IS NOT NULL THEN
    UPDATE company_users
    SET employee_id = COALESCE(v_employee_id, employee_id),
        role = CASE WHEN v_employee_id IS NOT NULL AND NOT v_matched_by_local_part THEN v_role ELSE role END
    WHERE id = v_cu_id;
    RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
  END IF;

  -- Claim orphaned company_users row (created during onboarding with null auth_user_id)
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

  -- No existing row — insert new
  INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
  VALUES (v_user_id, v_company_id, v_employee_id, v_role, true)
  ON CONFLICT (auth_user_id, company_id) DO UPDATE
    SET employee_id = COALESCE(EXCLUDED.employee_id, company_users.employee_id),
        role = CASE WHEN EXCLUDED.employee_id IS NOT NULL THEN EXCLUDED.role ELSE company_users.role END
  RETURNING id INTO v_cu_id;

  RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_company_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_company_user() TO authenticated;
