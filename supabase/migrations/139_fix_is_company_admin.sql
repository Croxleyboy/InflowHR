-- 139: Fix is_company_admin() to also check admin_portal_access
-- Root cause: AdminGate allows access via admin_portal_access table,
-- but is_company_admin() only checked company_users.role IN ('admin','hr').
-- Users with role='employee' (from SSO auto-enrollment) could enter
-- the admin portal but every RLS write policy blocked them.

CREATE OR REPLACE FUNCTION is_company_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE auth_user_id = auth.uid()
      AND is_active = true
      AND role IN ('admin', 'hr')
  )
  OR EXISTS (
    SELECT 1 FROM admin_portal_access apa
    JOIN employees e ON e.id = apa.employee_id
    WHERE e.auth_user_id = auth.uid()
  );
$$;
