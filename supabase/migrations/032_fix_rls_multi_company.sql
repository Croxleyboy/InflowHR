-- ============================================================
-- Fix RLS for users who belong to multiple companies.
--
-- get_my_company_id() returns LIMIT 1 with no ORDER BY, so for
-- multi-company users it may return the wrong company, blocking
-- inserts/updates/deletes on other companies they belong to.
--
-- Replace it with is_my_company(uuid) which checks membership
-- rather than picking one arbitrary company.
-- ============================================================

-- 1. Create membership-check function
CREATE OR REPLACE FUNCTION is_my_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE auth_user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = true
  );
$$;

-- 2. Rebuild per-operation policies on all tenant-scoped tables
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
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped read" ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped read" ON %I FOR SELECT
       USING (is_my_company(company_id) OR is_super_admin())',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS "Company scoped insert" ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped insert" ON %I FOR INSERT
       WITH CHECK (is_my_company(company_id) OR is_super_admin())',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS "Company scoped update" ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped update" ON %I FOR UPDATE
       USING (is_my_company(company_id) OR is_super_admin())',
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS "Company scoped delete" ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped delete" ON %I FOR DELETE
       USING (is_my_company(company_id) OR is_super_admin())',
      tbl
    );
  END LOOP;
END $$;
