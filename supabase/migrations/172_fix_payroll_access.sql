-- Fix has_payroll_access() for portal users whose employee.auth_user_id
-- may not be linked. Also grant access when a portal user has ANY portal
-- access row (via is_company_admin fallback) but the specific payroll
-- permission check failed due to the employee join.
--
-- The root issue: has_payroll_access joins admin_portal_access →
-- admin_portal_roles → employees WHERE e.auth_user_id = auth.uid().
-- If the employee record's auth_user_id isn't set, the join fails
-- even when payroll permission is correctly ticked.
--
-- Fix: also check via company_users.auth_user_id → employee_id path.

CREATE OR REPLACE FUNCTION has_payroll_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Path 1: employee.auth_user_id is linked (original path)
    EXISTS (
      SELECT 1
      FROM admin_portal_access apa
      JOIN admin_portal_roles apr ON apr.company_id = apa.company_id AND apr.role_key = apa.role_key
      JOIN employees e ON e.id = apa.employee_id
      WHERE e.auth_user_id = auth.uid()
        AND apa.company_id = p_company_id
        AND (apr.permissions->>'payroll')::boolean = true
    )
    -- Path 2: match via company_users.employee_id when auth_user_id not on employee
    OR EXISTS (
      SELECT 1
      FROM company_users cu
      JOIN admin_portal_access apa ON apa.company_id = cu.company_id AND apa.employee_id = cu.employee_id
      JOIN admin_portal_roles apr ON apr.company_id = apa.company_id AND apr.role_key = apa.role_key
      WHERE cu.auth_user_id = auth.uid()
        AND cu.company_id = p_company_id
        AND cu.is_active = true
        AND (apr.permissions->>'payroll')::boolean = true
    )
    OR is_company_admin()
    OR is_super_admin();
$$;
