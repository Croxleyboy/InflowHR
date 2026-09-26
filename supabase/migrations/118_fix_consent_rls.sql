-- Fix employee_consents RLS policies
-- INSERT/UPDATE policies relied on get_my_employee_id() which returns NULL
-- when the employee's auth_user_id isn't linked, blocking consent recording.

-- SELECT: keep existing (already has is_super_admin)
-- INSERT: allow own employee_id OR super admin
DROP POLICY IF EXISTS "Own consents insert" ON employee_consents;
CREATE POLICY "Own consents insert" ON employee_consents FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT cu.employee_id FROM company_users cu
      WHERE cu.auth_user_id = auth.uid()
        AND cu.employee_id IS NOT NULL
    )
    OR is_super_admin()
  );

-- UPDATE: allow own employee_id OR super admin
DROP POLICY IF EXISTS "Own consents update" ON employee_consents;
CREATE POLICY "Own consents update" ON employee_consents FOR UPDATE
  USING (
    employee_id IN (
      SELECT cu.employee_id FROM company_users cu
      WHERE cu.auth_user_id = auth.uid()
        AND cu.employee_id IS NOT NULL
    )
    OR is_super_admin()
  );
