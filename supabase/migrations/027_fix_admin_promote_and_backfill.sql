-- ============================================
-- 027: Fix admin promotion + backfill company_id on existing rows
--
-- 1. RPC to promote an employee to admin, linking their
--    company_users row by email → auth.users lookup
-- 2. Backfill company_id on tables where rows were created
--    before company_id was added to INSERTs
-- ============================================

-- 1. RPC: promote_employee_to_admin
-- Finds the employee's email, looks up their auth user,
-- and updates or creates the company_users row with role=admin
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
  -- Get employee email
  SELECT email INTO v_email
  FROM employees
  WHERE id = p_employee_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Find their auth user
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE email = v_email;

  -- Look for existing company_users row by auth_user_id
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

    -- Create row if they have an auth user but no company_users row
    INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
    VALUES (v_auth_user_id, p_company_id, p_employee_id, 'admin', true)
    ON CONFLICT (auth_user_id, company_id)
    DO UPDATE SET role = 'admin', employee_id = p_employee_id;
    RETURN;
  END IF;

  -- No auth user yet (hasn't logged in) — nothing to link
  -- The ensure_company_user RPC will pick up is_admin on first login
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_employee_to_admin(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.promote_employee_to_admin(uuid, uuid) TO authenticated;

-- ============================================
-- 2. Backfill company_id on existing rows
-- Uses employee → company_id mapping to fill in NULLs
-- ============================================

-- expense_claims: get company_id from employee
UPDATE expense_claims ec
SET company_id = e.company_id
FROM employees e
WHERE ec.employee_id = e.id
  AND ec.company_id IS NULL
  AND e.company_id IS NOT NULL;

-- expense_line_items: get company_id from parent claim
UPDATE expense_line_items eli
SET company_id = ec.company_id
FROM expense_claims ec
WHERE eli.expense_claim_id = ec.id
  AND eli.company_id IS NULL
  AND ec.company_id IS NOT NULL;

-- leave_requests: get company_id from employee
UPDATE leave_requests lr
SET company_id = e.company_id
FROM employees e
WHERE lr.employee_id = e.id
  AND lr.company_id IS NULL
  AND e.company_id IS NOT NULL;

-- kudos: get company_id from from_employee
UPDATE kudos k
SET company_id = e.company_id
FROM employees e
WHERE k.from_employee_id = e.id
  AND k.company_id IS NULL
  AND e.company_id IS NOT NULL;

-- workflow_tracker: get company_id from employee email
UPDATE workflow_tracker wt
SET company_id = e.company_id
FROM employees e
WHERE wt.employee_email = e.email
  AND wt.company_id IS NULL
  AND e.company_id IS NOT NULL;

-- announcements: get company_id from first matching employee domain
UPDATE announcements a
SET company_id = c.id
FROM companies c
WHERE a.company_id IS NULL
  AND c.is_active = true;

-- notifications: get company_id from employee
UPDATE notifications n
SET company_id = e.company_id
FROM employees e
WHERE n.employee_id = e.id
  AND n.company_id IS NULL
  AND e.company_id IS NOT NULL;

-- payslips: get company_id from employee
UPDATE payslips p
SET company_id = e.company_id
FROM employees e
WHERE p.employee_id = e.id
  AND p.company_id IS NULL
  AND e.company_id IS NOT NULL;

-- onboarding: get company_id from employee email
UPDATE onboarding o
SET company_id = e.company_id
FROM employees e
WHERE o.user_email = e.email
  AND o.company_id IS NULL
  AND e.company_id IS NOT NULL;

-- leave_balances: get company_id from employee
UPDATE leave_balances lb
SET company_id = e.company_id
FROM employees e
WHERE lb.employee_id = e.id
  AND lb.company_id IS NULL
  AND e.company_id IS NOT NULL;

-- leave_types: backfill from the first company if only one exists
-- (leave_types may be shared, so only backfill if there's one company)
UPDATE leave_types lt
SET company_id = (SELECT id FROM companies WHERE is_active = true LIMIT 1)
WHERE lt.company_id IS NULL
  AND (SELECT count(*) FROM companies WHERE is_active = true) = 1;

-- app_settings: backfill from company
UPDATE app_settings a_s
SET company_id = (SELECT id FROM companies WHERE is_active = true LIMIT 1)
WHERE a_s.company_id IS NULL
  AND (SELECT count(*) FROM companies WHERE is_active = true) = 1;
