-- ============================================================
-- 035: Add RLS to unprotected tables + fix stale get_my_company_id() policies
--
-- Three categories:
-- A) Tables created in the Supabase dashboard with company_id but no RLS
-- B) Tables with RLS using the old get_my_company_id() function
--    (timesheets, one_to_one_meetings, one_to_one_comments)
-- C) Global tables without company_id (subscription_pricing)
--
-- All tenant-scoped policies use is_my_company(company_id) from migration 032.
-- ============================================================

-- ============================================================
-- A) Enable RLS and add policies on tables missing them entirely
-- ============================================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'benefit_types',
    'benefit_options',
    'benefit_enrollments',
    'shift_templates',
    'shift_assignments',
    'rotas',
    'shift_swap_requests',
    'employee_availability',
    'legal_clients',
    'legal_matters',
    'legal_timesheet_entries',
    'company_elearning_courses',
    'company_features',
    'hr_tickets'
  ])
  LOOP
    -- Enable RLS (idempotent — safe if already enabled)
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- Drop any existing policies to avoid conflicts
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped insert" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped update" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped delete" ON %I', tbl);

    -- Create company-scoped policies
    EXECUTE format(
      'CREATE POLICY "Company scoped read" ON %I FOR SELECT
       USING (is_my_company(company_id) OR is_super_admin())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped insert" ON %I FOR INSERT
       WITH CHECK (is_my_company(company_id) OR is_super_admin())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped update" ON %I FOR UPDATE
       USING (is_my_company(company_id) OR is_super_admin())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped delete" ON %I FOR DELETE
       USING (is_my_company(company_id) OR is_super_admin())', tbl);
  END LOOP;
END $$;

-- ============================================================
-- B) Fix tables using stale get_my_company_id() function
--    Replace with is_my_company(company_id) from migration 032
-- ============================================================

-- timesheets (from migration 021)
DROP POLICY IF EXISTS "Timesheet company read"   ON timesheets;
DROP POLICY IF EXISTS "Timesheet company insert" ON timesheets;
DROP POLICY IF EXISTS "Timesheet company update" ON timesheets;
DROP POLICY IF EXISTS "Timesheet company delete" ON timesheets;

CREATE POLICY "Company scoped read"   ON timesheets FOR SELECT USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON timesheets FOR INSERT WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON timesheets FOR UPDATE USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON timesheets FOR DELETE USING (is_my_company(company_id) OR is_super_admin());

-- one_to_one_meetings (from migration 024)
DROP POLICY IF EXISTS "121_company_read"   ON one_to_one_meetings;
DROP POLICY IF EXISTS "121_company_insert" ON one_to_one_meetings;
DROP POLICY IF EXISTS "121_company_update" ON one_to_one_meetings;
DROP POLICY IF EXISTS "121_company_delete" ON one_to_one_meetings;

CREATE POLICY "Company scoped read"   ON one_to_one_meetings FOR SELECT USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON one_to_one_meetings FOR INSERT WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON one_to_one_meetings FOR UPDATE USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON one_to_one_meetings FOR DELETE USING (is_my_company(company_id) OR is_super_admin());

-- one_to_one_comments (from migration 024)
DROP POLICY IF EXISTS "121_comments_read"   ON one_to_one_comments;
DROP POLICY IF EXISTS "121_comments_insert" ON one_to_one_comments;
DROP POLICY IF EXISTS "121_comments_update" ON one_to_one_comments;
DROP POLICY IF EXISTS "121_comments_delete" ON one_to_one_comments;

CREATE POLICY "Company scoped read"   ON one_to_one_comments FOR SELECT USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON one_to_one_comments FOR INSERT WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON one_to_one_comments FOR UPDATE USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON one_to_one_comments FOR DELETE USING (is_my_company(company_id) OR is_super_admin());

-- ============================================================
-- B2) Fix companies and company_users — still using get_my_company_id()
--     from migration 001/018, missed by migration 032's fix loop
-- ============================================================

-- companies (SELECT only for regular users, all ops for super admin)
DROP POLICY IF EXISTS "Users can view own company" ON companies;
DROP POLICY IF EXISTS "Company read policy" ON companies;
CREATE POLICY "Company scoped read" ON companies FOR SELECT
  USING (is_my_company(id) OR is_super_admin());

-- company_users
DROP POLICY IF EXISTS "Users can view own company users" ON company_users;
DROP POLICY IF EXISTS "Users can view company users" ON company_users;
DROP POLICY IF EXISTS "Admins can insert company users" ON company_users;
DROP POLICY IF EXISTS "Admins can update company users" ON company_users;
DROP POLICY IF EXISTS "Company users read policy" ON company_users;
DROP POLICY IF EXISTS "Company users insert policy" ON company_users;
DROP POLICY IF EXISTS "Company users update policy" ON company_users;

CREATE POLICY "Company scoped read" ON company_users FOR SELECT
  USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON company_users FOR INSERT
  WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON company_users FOR UPDATE
  USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON company_users FOR DELETE
  USING (is_my_company(company_id) OR is_super_admin());

-- ============================================================
-- C) Global tables — read-only for authenticated, no company_id
-- ============================================================
ALTER TABLE subscription_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read pricing" ON subscription_pricing;
CREATE POLICY "Authenticated read pricing" ON subscription_pricing
  FOR SELECT TO authenticated USING (true);
-- Block anon entirely
DROP POLICY IF EXISTS "anon_blocked_read_subscription_pricing" ON subscription_pricing;
CREATE POLICY "anon_blocked_read_subscription_pricing" ON subscription_pricing
  FOR SELECT TO anon USING (false);
