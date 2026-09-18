-- ============================================================
-- 097: Security Audit V2 Fixes
-- Addresses findings from the deep security scan (Sep 2026)
-- ============================================================


-- ============================================================
-- F1 (CRITICAL): Drop stale USING(true) SELECT policies from
-- migration 001 that were never removed by migration 020.
-- Migration 020 tried to drop "Authenticated users can read"
-- but the original names include the table suffix, so the
-- drops were no-ops. The old USING(true) policies OR-combine
-- with the company-scoped ones, granting cross-tenant reads.
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can read employees" ON employees;
DROP POLICY IF EXISTS "Authenticated users can read leave types" ON leave_types;
DROP POLICY IF EXISTS "Authenticated users can read public kudos" ON kudos;
DROP POLICY IF EXISTS "Authenticated users can read benefits" ON benefits;
DROP POLICY IF EXISTS "Authenticated users can read courses" ON courses;
DROP POLICY IF EXISTS "Authenticated users can read announcements" ON announcements;

-- benefits and courses have NO company-scoped SELECT policy —
-- migration 020 loop did not include them. Create replacements.
-- (employees, leave_types, kudos, announcements already have
-- "Company scoped read" from migration 020.)

CREATE POLICY "Company scoped read" ON benefits FOR SELECT
  TO authenticated
  USING (company_id = get_my_company_id() OR company_id IS NULL OR is_super_admin());

CREATE POLICY "Company scoped read" ON courses FOR SELECT
  TO authenticated
  USING (company_id = get_my_company_id() OR company_id IS NULL OR is_super_admin());


-- ============================================================
-- F2 (MEDIUM): company_users UPDATE/DELETE must require admin.
-- Migration 047 dropped the admin check — any company employee
-- can update their own role to 'admin'.
-- ============================================================

DROP POLICY IF EXISTS "Company scoped update" ON company_users;
DROP POLICY IF EXISTS "Company scoped delete" ON company_users;

CREATE POLICY "Admin scoped update" ON company_users FOR UPDATE
  TO authenticated
  USING ((is_company_admin() AND is_my_company(company_id)) OR is_super_admin());

CREATE POLICY "Admin scoped delete" ON company_users FOR DELETE
  TO authenticated
  USING ((is_company_admin() AND is_my_company(company_id)) OR is_super_admin());


-- ============================================================
-- F3 (MEDIUM): Tighten write policies on admin-managed tables
-- that migration 056 missed. announcements, workflow_tracker,
-- and notifications still allow any company member to write.
-- ============================================================

-- announcements
DROP POLICY IF EXISTS "Company scoped insert" ON announcements;
DROP POLICY IF EXISTS "Company scoped update" ON announcements;
DROP POLICY IF EXISTS "Company scoped delete" ON announcements;

CREATE POLICY "announcements_admin_insert" ON announcements FOR INSERT
  TO authenticated
  WITH CHECK ((is_company_admin() AND company_id = get_my_company_id()) OR is_super_admin());

CREATE POLICY "announcements_admin_update" ON announcements FOR UPDATE
  TO authenticated
  USING ((is_company_admin() AND company_id = get_my_company_id()) OR is_super_admin());

CREATE POLICY "announcements_admin_delete" ON announcements FOR DELETE
  TO authenticated
  USING ((is_company_admin() AND company_id = get_my_company_id()) OR is_super_admin());

-- workflow_tracker
DROP POLICY IF EXISTS "Company scoped insert" ON workflow_tracker;
DROP POLICY IF EXISTS "Company scoped update" ON workflow_tracker;
DROP POLICY IF EXISTS "Company scoped delete" ON workflow_tracker;

CREATE POLICY "workflow_tracker_admin_insert" ON workflow_tracker FOR INSERT
  TO authenticated
  WITH CHECK ((is_company_admin() AND company_id = get_my_company_id()) OR is_super_admin());

CREATE POLICY "workflow_tracker_admin_update" ON workflow_tracker FOR UPDATE
  TO authenticated
  USING ((is_company_admin() AND company_id = get_my_company_id()) OR is_super_admin());

CREATE POLICY "workflow_tracker_admin_delete" ON workflow_tracker FOR DELETE
  TO authenticated
  USING ((is_company_admin() AND company_id = get_my_company_id()) OR is_super_admin());

-- notifications
DROP POLICY IF EXISTS "Company scoped insert" ON notifications;
DROP POLICY IF EXISTS "Company scoped update" ON notifications;
DROP POLICY IF EXISTS "Company scoped delete" ON notifications;

CREATE POLICY "notifications_admin_insert" ON notifications FOR INSERT
  TO authenticated
  WITH CHECK ((is_company_admin() AND company_id = get_my_company_id()) OR is_super_admin());

CREATE POLICY "notifications_admin_update" ON notifications FOR UPDATE
  TO authenticated
  USING ((is_company_admin() AND company_id = get_my_company_id()) OR is_super_admin());

CREATE POLICY "notifications_admin_delete" ON notifications FOR DELETE
  TO authenticated
  USING ((is_company_admin() AND company_id = get_my_company_id()) OR is_super_admin());


-- ============================================================
-- F5 (MEDIUM): company-logos storage bucket — scope upload and
-- update policies to the user's own company + admin role.
-- Path format is "{companyId}.{ext}" (flat, no folders).
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can upload company logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update company logos" ON storage.objects;

CREATE POLICY "Company admin can upload logos" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'company-logos'
    AND split_part(name, '.', 1) = get_my_company_id()::text
    AND (is_company_admin() OR is_super_admin())
  );

CREATE POLICY "Company admin can update logos" ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND split_part(name, '.', 1) = get_my_company_id()::text
    AND (is_company_admin() OR is_super_admin())
  );


-- ============================================================
-- F6 (MEDIUM): cancel_current_month_checkins — the function
-- checks is_company_admin() globally but operates on an
-- arbitrary p_company_id, allowing cross-tenant cancellation.
-- Replace with targeted company_id check.
-- ============================================================

CREATE OR REPLACE FUNCTION cancel_current_month_checkins(
  p_company_id uuid,
  p_source text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM company_users
      WHERE auth_user_id = auth.uid()
        AND company_id = p_company_id
        AND is_active = true
        AND role IN ('admin', 'hr')
    ) OR is_super_admin()
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin access required for this company';
  END IF;

  IF p_source NOT IN ('timesheets', 'shifts') THEN
    RAISE EXCEPTION 'Invalid source: must be timesheets or shifts';
  END IF;

  UPDATE checkin_records
  SET status = 'cancelled',
      check_out_at = COALESCE(check_out_at, now()),
      updated_at = now()
  WHERE company_id = p_company_id
    AND source = p_source
    AND check_in_at >= date_trunc('month', now())
    AND status IN ('checked_in', 'checked_out');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


-- ============================================================
-- F8 (LOW): Restrict file uploads to allowed types only.
-- Replaces the existing tenant-scoped receipt upload policy
-- with one that also validates file extensions. PostgreSQL
-- OR-combines multiple policies, so we must replace, not add.
-- ============================================================

DROP POLICY IF EXISTS "Tenant scoped receipt upload" ON storage.objects;

CREATE POLICY "Tenant scoped receipt upload" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] IN (
      SELECT cu.company_id::text FROM company_users cu
      WHERE cu.auth_user_id = auth.uid() AND cu.is_active = true
    )
    AND (storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'json')
  );


-- ============================================================
-- F9 (LOW): Remove unnecessary DISABLE/ENABLE RLS from
-- SECURITY DEFINER function bodies. SECURITY DEFINER already
-- bypasses RLS. If the function errors between DISABLE and
-- ENABLE, RLS is left off until someone notices.
-- ============================================================

-- Recreate delete_company_data without DISABLE/ENABLE RLS
-- (SECURITY DEFINER already bypasses RLS)
CREATE OR REPLACE FUNCTION public.delete_company_data(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_name text;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;

  DELETE FROM gdpr_audit_logs           WHERE company_id = p_company_id;
  DELETE FROM tenant_support_access     WHERE company_id = p_company_id;
  DELETE FROM benefit_enrollments       WHERE company_id = p_company_id;
  DELETE FROM benefit_options           WHERE company_id = p_company_id;
  DELETE FROM benefit_types             WHERE company_id = p_company_id;
  DELETE FROM shift_swap_requests       WHERE company_id = p_company_id;
  DELETE FROM shift_assignments         WHERE company_id = p_company_id;
  DELETE FROM shift_templates           WHERE company_id = p_company_id;
  DELETE FROM rotas                     WHERE company_id = p_company_id;
  DELETE FROM employee_availability     WHERE company_id = p_company_id;
  DELETE FROM legal_timesheet_entries   WHERE company_id = p_company_id;
  DELETE FROM legal_matters             WHERE company_id = p_company_id;
  DELETE FROM legal_clients             WHERE company_id = p_company_id;
  DELETE FROM hr_tickets                WHERE company_id = p_company_id;

  DELETE FROM one_to_one_comments WHERE company_id = p_company_id;
  DELETE FROM one_to_one_meetings WHERE company_id = p_company_id;
  DELETE FROM workflow_tracker     WHERE company_id = p_company_id;
  DELETE FROM notifications        WHERE company_id = p_company_id;
  DELETE FROM timesheets           WHERE company_id = p_company_id;
  DELETE FROM expense_line_items   WHERE company_id = p_company_id;
  DELETE FROM expense_claims       WHERE company_id = p_company_id;
  DELETE FROM leave_requests       WHERE company_id = p_company_id;
  DELETE FROM leave_balances       WHERE company_id = p_company_id;
  DELETE FROM course_enrolments    WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id);
  DELETE FROM employee_benefits    WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id);
  DELETE FROM performance_reviews  WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id);
  DELETE FROM kudos                WHERE company_id = p_company_id;
  DELETE FROM payslips             WHERE company_id = p_company_id;
  DELETE FROM onboarding           WHERE company_id = p_company_id;
  DELETE FROM announcements        WHERE company_id = p_company_id;
  DELETE FROM user_settings        WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id);
  DELETE FROM app_settings         WHERE company_id = p_company_id;
  DELETE FROM company_features     WHERE company_id = p_company_id;
  DELETE FROM company_elearning_courses WHERE company_id = p_company_id;
  DELETE FROM benefits             WHERE company_id = p_company_id;
  DELETE FROM courses              WHERE company_id = p_company_id;
  DELETE FROM company_users        WHERE company_id = p_company_id;
  DELETE FROM employees            WHERE company_id = p_company_id;
  DELETE FROM leave_types          WHERE company_id = p_company_id;
  DELETE FROM companies            WHERE id = p_company_id;

  RETURN 'Deleted all data for company: ' || v_company_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_company_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_company_data(uuid) TO authenticated;
