-- ============================================================================
-- 081 — Fix Skills Passport RLS policies
-- Add OR is_super_admin() to match pattern used by all other tenant tables.
-- Also adds is_active column to skills for company-level disable.
-- ============================================================================

-- ─── Add is_active to skills so companies can disable without deleting ───────
ALTER TABLE skills ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ─── Helper: rebuild 4 policies on a table ──────────────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'skill_categories','skills','employee_skills','skill_evidence',
    'employee_certifications','employee_career_aspirations',
    'role_profiles','role_skill_requirements','skill_validations'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped read"   ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped insert" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped update" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped delete" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "Company scoped read" ON %I FOR SELECT
       USING (can_access_company(company_id) OR is_super_admin())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped insert" ON %I FOR INSERT
       WITH CHECK (can_access_company(company_id) OR is_super_admin())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped update" ON %I FOR UPDATE
       USING (can_access_company(company_id) OR is_super_admin())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped delete" ON %I FOR DELETE
       USING (can_access_company(company_id) OR is_super_admin())', tbl);
  END LOOP;
END $$;
