-- ============================================================
-- Super admin: cross-company access for andy.jones@kumonix.com
-- ============================================================

-- 1. Create is_super_admin() function
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT email = 'andy.jones@kumonix.com'
    FROM auth.users
    WHERE id = auth.uid()
  );
END;
$$;

-- 2. Update RLS SELECT policies on all tenant-scoped tables
--    so super admin can see ALL rows regardless of company_id

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'employees', 'expense_claims', 'expense_line_items',
    'leave_requests', 'leave_balances', 'leave_types',
    'onboarding', 'kudos', 'announcements', 'payslips',
    'workflow_tracker', 'notifications', 'app_settings'
  ])
  LOOP
    -- Drop any existing policies (original names + our own from prior runs)
    EXECUTE format('DROP POLICY IF EXISTS "Users can view own company %1$s" ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company data visible to members" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Enable read access for all users" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped read" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "Company scoped read" ON %I FOR SELECT
       USING (company_id = get_my_company_id() OR is_super_admin())',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS "Users can insert own company %1$s" ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can insert" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped insert" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "Company scoped insert" ON %I FOR INSERT
       WITH CHECK (company_id = get_my_company_id() OR is_super_admin())',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS "Users can update own company %1$s" ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can update" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Enable update for authenticated users" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped update" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "Company scoped update" ON %I FOR UPDATE
       USING (company_id = get_my_company_id() OR is_super_admin())',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS "Users can delete own company %1$s" ON %1$I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can delete" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Enable delete for authenticated users" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped delete" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "Company scoped delete" ON %I FOR DELETE
       USING (company_id = get_my_company_id() OR is_super_admin())',
      tbl
    );
  END LOOP;
END $$;

-- 3. Also allow super admin to insert company_users for any company
DROP POLICY IF EXISTS "Admins can insert company users" ON company_users;
CREATE POLICY "Admins can insert company users"
  ON company_users FOR INSERT
  WITH CHECK (is_company_admin() OR is_super_admin());

-- 4. Super admin can update company_users for any company
DROP POLICY IF EXISTS "Admins can update company users" ON company_users;
CREATE POLICY "Admins can update company users"
  ON company_users FOR UPDATE
  USING (is_company_admin() OR is_super_admin());

-- 5. Fix unique constraints for multi-tenancy
--    leave_types.name must be unique per company, not globally
ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_name_key;
ALTER TABLE leave_types ADD CONSTRAINT leave_types_name_company_key UNIQUE (name, company_id);

-- 6. app_settings: remove single-row check constraint for multi-tenant
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'app_settings'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE app_settings DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
