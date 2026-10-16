-- Migration 198: Enforce guest read-only at the database level (CWE-602)
-- Finding #6: Guest read-only flag is only checked in the React UI.
-- A read-only guest who bypasses the UI (e.g. via PostgREST API) can
-- INSERT/UPDATE/DELETE on any table whose write policy uses
-- can_access_company(). This migration blocks that path.

-- 1. Helper function: returns true when the caller is a guest with read_only = true
CREATE OR REPLACE FUNCTION public.is_read_only_guest()
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM guest_users
    WHERE guest_users.auth_user_id = auth.uid()
      AND guest_users.is_active = true
      AND guest_users.read_only = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_read_only_guest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_read_only_guest() TO authenticated;

-- 2. Update write policies on tables from migration 049 (batch loop tables)
-- Tables: company_features, leave_types, benefit_types, benefit_options,
--         shift_templates, company_elearning_courses, legal_clients,
--         legal_matters, customer_projects, app_settings, announcements
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'company_features',
    'leave_types',
    'benefit_types',
    'benefit_options',
    'shift_templates',
    'company_elearning_courses',
    'legal_clients',
    'legal_matters',
    'customer_projects',
    'app_settings',
    'announcements'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped insert" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped update" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped delete" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "Company scoped insert" ON %I FOR INSERT
       WITH CHECK ((can_access_company(company_id) OR is_super_admin()) AND NOT is_read_only_guest())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped update" ON %I FOR UPDATE
       USING ((can_access_company(company_id) OR is_super_admin()) AND NOT is_read_only_guest())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped delete" ON %I FOR DELETE
       USING ((can_access_company(company_id) OR is_super_admin()) AND NOT is_read_only_guest())', tbl);
  END LOOP;
END $$;

-- 3. hr_tickets (migration 049, standalone)
DROP POLICY IF EXISTS "Company scoped insert" ON hr_tickets;
CREATE POLICY "Company scoped insert" ON hr_tickets FOR INSERT
  WITH CHECK ((can_access_company(company_id) OR is_super_admin()) AND NOT is_read_only_guest());

DROP POLICY IF EXISTS "Company scoped update" ON hr_tickets;
CREATE POLICY "Company scoped update" ON hr_tickets FOR UPDATE
  USING ((can_access_company(company_id) OR (is_super_admin() AND assigned_to_provider = true)) AND NOT is_read_only_guest());

DROP POLICY IF EXISTS "Company scoped delete" ON hr_tickets;
CREATE POLICY "Company scoped delete" ON hr_tickets FOR DELETE
  USING (can_access_company(company_id) AND NOT is_read_only_guest());

-- 4. xero_integrations (migration 074)
DROP POLICY IF EXISTS "Company scoped insert" ON xero_integrations;
CREATE POLICY "Company scoped insert" ON xero_integrations FOR INSERT
  WITH CHECK (can_access_company(company_id) AND NOT is_read_only_guest());

DROP POLICY IF EXISTS "Company scoped update" ON xero_integrations;
CREATE POLICY "Company scoped update" ON xero_integrations FOR UPDATE
  USING (can_access_company(company_id) AND NOT is_read_only_guest());

DROP POLICY IF EXISTS "Company scoped delete" ON xero_integrations;
CREATE POLICY "Company scoped delete" ON xero_integrations FOR DELETE
  USING (can_access_company(company_id) AND NOT is_read_only_guest());

-- 5. asset_updates (migration 077)
DROP POLICY IF EXISTS "Company scoped insert" ON asset_updates;
CREATE POLICY "Company scoped insert" ON asset_updates FOR INSERT
  WITH CHECK (can_access_company(company_id) AND NOT is_read_only_guest());

DROP POLICY IF EXISTS "Company scoped update" ON asset_updates;
CREATE POLICY "Company scoped update" ON asset_updates FOR UPDATE
  USING (can_access_company(company_id) AND NOT is_read_only_guest());

DROP POLICY IF EXISTS "Company scoped delete" ON asset_updates;
CREATE POLICY "Company scoped delete" ON asset_updates FOR DELETE
  USING (can_access_company(company_id) AND NOT is_read_only_guest());

-- 6. Skills passport tables (migration 080)
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'skill_categories',
    'skills',
    'employee_skills',
    'skill_evidence',
    'employee_certifications',
    'employee_career_aspirations',
    'role_profiles',
    'role_skill_requirements',
    'skill_validations'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped insert" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped update" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped delete" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "Company scoped insert" ON %I FOR INSERT
       WITH CHECK (can_access_company(company_id) AND NOT is_read_only_guest())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped update" ON %I FOR UPDATE
       USING (can_access_company(company_id) AND NOT is_read_only_guest())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped delete" ON %I FOR DELETE
       USING (can_access_company(company_id) AND NOT is_read_only_guest())', tbl);
  END LOOP;
END $$;
