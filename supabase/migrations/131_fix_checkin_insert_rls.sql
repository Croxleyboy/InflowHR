-- Fix checkin_records INSERT policy to allow company admins and super admins
-- to insert check-in records (e.g. when an admin also has an employee record).
-- The original policy only matched if company_users had a non-null employee_id
-- for the auth user, which fails for admin-only users or mismatched lookups.

DROP POLICY IF EXISTS "cr_insert" ON checkin_records;

CREATE POLICY "cr_insert" ON checkin_records FOR INSERT
  WITH CHECK (
    company_id = get_my_company_id()
    AND (
      employee_id IN (
        SELECT employee_id FROM company_users
        WHERE auth_user_id = auth.uid() AND is_active = true AND employee_id IS NOT NULL
      )
      OR is_company_admin()
      OR is_super_admin()
    )
  );
