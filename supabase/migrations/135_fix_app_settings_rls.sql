-- CR-11: Fix app_settings RLS policies
-- 1. Drop the cross-tenant UPDATE policy from migration 093 that lacks company_id scoping.
--    The properly scoped "app_settings_admin_update" from migration 056 remains.
-- 2. Add a company-scoped SELECT policy for authenticated users, since migration 102
--    dropped the USING(true) SELECT without creating a replacement.

-- Drop the loose UPDATE policy (migration 093)
DROP POLICY IF EXISTS "Admins can update app_settings" ON app_settings;

-- Add company-scoped SELECT for authenticated users
CREATE POLICY "Company scoped read app_settings"
  ON app_settings FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());
