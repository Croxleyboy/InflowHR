-- Fix expense_cost_centers and expense_expense_types RLS policies
-- Problem: INSERT policy checked company_users.role='admin' by auth_user_id,
-- but setup wizard created admin records without auth_user_id, so the check failed.
-- Solution: align with standard pattern (get_my_company_id + is_super_admin)
-- and add missing UPDATE policies.

-- 1. Clean up orphaned company_users rows (no auth_user_id where a linked row exists)
DELETE FROM company_users cu1
WHERE cu1.auth_user_id IS NULL
  AND EXISTS (
    SELECT 1 FROM company_users cu2
    WHERE cu2.company_id = cu1.company_id
      AND cu2.auth_user_id IS NOT NULL
      AND cu2.employee_id = cu1.employee_id
  );

-- 2. For any remaining orphaned admin rows, promote the linked row
UPDATE company_users cu_linked
SET role = 'admin'
FROM company_users cu_orphan
WHERE cu_orphan.auth_user_id IS NULL
  AND cu_orphan.role = 'admin'
  AND cu_orphan.company_id = cu_linked.company_id
  AND cu_orphan.employee_id = cu_linked.employee_id
  AND cu_linked.auth_user_id IS NOT NULL
  AND cu_linked.role != 'admin';

-- 3. Replace expense_cost_centers INSERT/DELETE with standard pattern, add UPDATE
DROP POLICY IF EXISTS "expense_cost_centers_insert" ON expense_cost_centers;
CREATE POLICY "expense_cost_centers_insert" ON expense_cost_centers
  FOR INSERT WITH CHECK (
    company_id = get_my_company_id() OR is_super_admin()
  );

DROP POLICY IF EXISTS "expense_cost_centers_delete" ON expense_cost_centers;
CREATE POLICY "expense_cost_centers_delete" ON expense_cost_centers
  FOR DELETE USING (
    company_id = get_my_company_id() OR is_super_admin()
  );

CREATE POLICY "expense_cost_centers_update" ON expense_cost_centers
  FOR UPDATE USING (
    company_id = get_my_company_id() OR is_super_admin()
  );

-- 4. Replace expense_expense_types INSERT/DELETE with standard pattern, add UPDATE
DROP POLICY IF EXISTS "expense_expense_types_insert" ON expense_expense_types;
CREATE POLICY "expense_expense_types_insert" ON expense_expense_types
  FOR INSERT WITH CHECK (
    company_id = get_my_company_id() OR is_super_admin()
  );

DROP POLICY IF EXISTS "expense_expense_types_delete" ON expense_expense_types;
CREATE POLICY "expense_expense_types_delete" ON expense_expense_types
  FOR DELETE USING (
    company_id = get_my_company_id() OR is_super_admin()
  );

CREATE POLICY "expense_expense_types_update" ON expense_expense_types
  FOR UPDATE USING (
    company_id = get_my_company_id() OR is_super_admin()
  );
