-- ============================================================
-- 034: Block all anon access to tenant data
--
-- Migration 026 replaced USING(true) with USING(company_id IS NOT NULL)
-- on anon policies, but that still allows ANY unauthenticated request
-- (using the publicly-exposed anon key) to read/write ALL rows that
-- have a non-null company_id — which is every real row.
--
-- The app uses Microsoft Entra ID SSO; all legitimate queries run as
-- the authenticated role. There is no use case for anon data access.
--
-- This migration drops every anon data policy from 026 and replaces
-- them with USING(false) / WITH CHECK(false) to block anon entirely.
-- Non-sensitive config tables (user_settings, app_translations) keep
-- anon read access since they contain no tenant data.
-- ============================================================

-- ============================================================
-- STEP 0: Drop rogue anon policies from pre-026 migrations
-- that were never cleaned up. These grant USING(true) on
-- employees UPDATE and DELETE — the most dangerous gap.
-- ============================================================
DROP POLICY IF EXISTS "Anon can update employees (temp)" ON employees;
DROP POLICY IF EXISTS "Anon can delete employees (temp)" ON employees;

CREATE POLICY "anon_blocked_update_employees" ON employees FOR UPDATE TO anon USING (false);
CREATE POLICY "anon_blocked_delete_employees" ON employees FOR DELETE TO anon USING (false);

-- Helper: tables that had anon SELECT only
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'employees',
    'leave_types',
    'leave_balances',
    'leave_requests',
    'payslips',
    'notifications',
    'benefits',
    'employee_benefits',
    'courses',
    'course_enrolments',
    'performance_reviews'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_company_read_%s" ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "anon_blocked_read_%s" ON %I FOR SELECT TO anon USING (false)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Tables that had anon SELECT + INSERT + UPDATE + DELETE
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'expense_claims',
    'expense_line_items',
    'kudos',
    'workflow_tracker',
    'onboarding'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_company_read_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "anon_company_insert_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "anon_company_update_%s" ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "anon_company_delete_%s" ON %I', tbl, tbl);

    EXECUTE format(
      'CREATE POLICY "anon_blocked_read_%s" ON %I FOR SELECT TO anon USING (false)',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY "anon_blocked_insert_%s" ON %I FOR INSERT TO anon WITH CHECK (false)',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY "anon_blocked_update_%s" ON %I FOR UPDATE TO anon USING (false)',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY "anon_blocked_delete_%s" ON %I FOR DELETE TO anon USING (false)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- announcements: had anon SELECT + INSERT
DROP POLICY IF EXISTS "anon_company_read_announcements" ON announcements;
DROP POLICY IF EXISTS "anon_company_insert_announcements" ON announcements;
CREATE POLICY "anon_blocked_read_announcements" ON announcements FOR SELECT TO anon USING (false);
CREATE POLICY "anon_blocked_insert_announcements" ON announcements FOR INSERT TO anon WITH CHECK (false);

-- leave_requests: had anon SELECT + DELETE
DROP POLICY IF EXISTS "anon_company_delete_leave_requests" ON leave_requests;
CREATE POLICY "anon_blocked_delete_leave_requests" ON leave_requests FOR DELETE TO anon USING (false);

-- app_settings: had anon SELECT + UPDATE
DROP POLICY IF EXISTS "anon_company_read_app_settings" ON app_settings;
DROP POLICY IF EXISTS "anon_company_update_app_settings" ON app_settings;
CREATE POLICY "anon_blocked_read_app_settings" ON app_settings FOR SELECT TO anon USING (false);
CREATE POLICY "anon_blocked_update_app_settings" ON app_settings FOR UPDATE TO anon USING (false);

-- user_settings: KEEP anon read — non-sensitive shared config, no company_id
-- (policy "anon_company_read_user_settings" with USING(true) stays untouched)

-- app_translations: KEEP anon read — shared translation strings, no company_id
-- (existing open policies from migration 011 stay untouched)
