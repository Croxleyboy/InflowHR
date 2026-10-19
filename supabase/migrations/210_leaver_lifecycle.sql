-- ============================================================
-- 210: Leaver Lifecycle — Full Offboarding Data Management
-- Adds review step tracking, GDPR export, frozen countdown/extend,
-- benefit unenrolment, payroll leaver columns, deletion certificates,
-- and a complete purge function that permanently deletes ALL data.
-- ============================================================

-- ── A. New columns on offboarding ──────────────────────────────────────
ALTER TABLE offboarding
  ADD COLUMN IF NOT EXISTS data_export_url TEXT,
  ADD COLUMN IF NOT EXISTS data_exported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleanup_bookings_done BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cleanup_shifts_done BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cleanup_benefits_done BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cleanup_assets_done BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_steps_completed JSONB DEFAULT '{}'::jsonb;

-- ── B. New columns on frozen_employees ─────────────────────────────────
ALTER TABLE frozen_employees
  ADD COLUMN IF NOT EXISTS extended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_export_url TEXT,
  ADD COLUMN IF NOT EXISTS payroll_cleared BOOLEAN NOT NULL DEFAULT false;

-- ── C. Benefit unenrolment columns ─────────────────────────────────────
ALTER TABLE employee_benefits
  ADD COLUMN IF NOT EXISTS unenrolled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unenrolled_reason TEXT;

-- ── D. Payroll leaver columns on employees ─────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS leaving_date DATE,
  ADD COLUMN IF NOT EXISTS payroll_leaver_status TEXT DEFAULT 'active'
    CHECK (payroll_leaver_status IN ('active', 'final_run_pending', 'final_run_complete'));

-- ── E. Deletion certificates table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS deletion_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_name TEXT NOT NULL,
  employee_email TEXT NOT NULL,
  employee_id UUID NOT NULL,
  leaving_date DATE,
  leaving_reason TEXT,
  frozen_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_days INTEGER NOT NULL DEFAULT 30,
  data_export_provided BOOLEAN NOT NULL DEFAULT false,
  data_categories_held JSONB NOT NULL DEFAULT '[]'::jsonb,
  deletion_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  certificate_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE deletion_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins can view their deletion certificates"
  ON deletion_certificates FOR SELECT
  USING (is_my_company(company_id) AND (is_company_admin() OR is_super_admin()));

CREATE POLICY "Super admins full access to deletion certificates"
  ON deletion_certificates FOR ALL
  USING (is_super_admin());

-- ── F. delete_employee_permanently — removes ALL data ──────────────────
-- Called by the daily purge cron. Deletes every row referencing
-- the employee across all tables, then removes the employee record
-- itself. Produces a deletion certificate before destroying data.
CREATE OR REPLACE FUNCTION delete_employee_permanently(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp              record;
  v_company_id       uuid;
  v_frozen           record;
  v_cert_ref         text;
  v_counts           jsonb := '{}'::jsonb;
  v_deleted          integer;
  v_categories       jsonb := '[]'::jsonb;
  v_offboarding      record;
BEGIN
  IF NOT (is_super_admin() OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'Only super admin or postgres can call this function';
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  v_company_id := v_emp.company_id;

  SELECT * INTO v_frozen FROM frozen_employees
    WHERE employee_id = p_employee_id AND status = 'awaiting_expiry'
    LIMIT 1;

  SELECT * INTO v_offboarding FROM offboarding
    WHERE employee_id = p_employee_id
    ORDER BY created_at DESC LIMIT 1;

  v_cert_ref := 'DEL-' || to_char(now(), 'YYYYMMDD') || '-' || substr(md5(p_employee_id::text || now()::text), 1, 8);

  -- ── Count data per category before deletion (for certificate) ──
  SELECT count(*) INTO v_deleted FROM leave_requests WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('leave_requests', v_deleted); v_categories := v_categories || '"leave_requests"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM leave_balances WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('leave_balances', v_deleted); v_categories := v_categories || '"leave_balances"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM payslips WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('payslips', v_deleted); v_categories := v_categories || '"payslips"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM expense_claims WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('expense_claims', v_deleted); v_categories := v_categories || '"expense_claims"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM timesheets WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('timesheets', v_deleted); v_categories := v_categories || '"timesheets"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM shift_assignments WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('shift_assignments', v_deleted); v_categories := v_categories || '"shift_assignments"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM performance_reviews WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('performance_reviews', v_deleted); v_categories := v_categories || '"performance_reviews"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM employee_benefits WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('employee_benefits', v_deleted); v_categories := v_categories || '"employee_benefits"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM space_bookings WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('space_bookings', v_deleted); v_categories := v_categories || '"space_bookings"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM notifications WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('notifications', v_deleted); v_categories := v_categories || '"notifications"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM kudos WHERE from_employee_id = p_employee_id OR to_employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('kudos', v_deleted); v_categories := v_categories || '"kudos"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('one_to_one_meetings', v_deleted); v_categories := v_categories || '"one_to_one_meetings"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM course_enrolments WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('course_enrolments', v_deleted); v_categories := v_categories || '"course_enrolments"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM onboarding WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('onboarding', v_deleted); v_categories := v_categories || '"onboarding"'::jsonb; END IF;

  SELECT count(*) INTO v_deleted FROM offboarding WHERE employee_id = p_employee_id;
  IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object('offboarding', v_deleted); v_categories := v_categories || '"offboarding"'::jsonb; END IF;

  -- ── Create the deletion certificate BEFORE destroying data ──
  INSERT INTO deletion_certificates (
    company_id, employee_name, employee_email, employee_id,
    leaving_date, leaving_reason, frozen_at, deleted_at,
    retention_days, data_export_provided, data_categories_held,
    deletion_summary, certificate_reference
  ) VALUES (
    v_company_id,
    COALESCE(v_emp.first_name, '') || ' ' || COALESCE(v_emp.last_name, ''),
    COALESCE(v_emp.email, ''),
    p_employee_id,
    v_emp.leaving_date,
    COALESCE(v_offboarding.reason, NULL),
    COALESCE(v_frozen.frozen_at, NULL),
    now(),
    30 + COALESCE(v_frozen.extension_days, 0),
    COALESCE(v_frozen.data_export_url IS NOT NULL, false),
    v_categories,
    v_counts,
    v_cert_ref
  );

  -- ── Delete ALL related data (order: dependents first) ──

  -- M365 offboarding actions (depends on offboarding)
  DELETE FROM offboarding_m365_actions WHERE offboarding_id IN
    (SELECT id FROM offboarding WHERE employee_id = p_employee_id);

  -- Tables without ON DELETE CASCADE — must delete explicitly
  DELETE FROM expense_line_items WHERE expense_claim_id IN
    (SELECT id FROM expense_claims WHERE employee_id = p_employee_id);
  DELETE FROM expense_claims WHERE employee_id = p_employee_id;
  DELETE FROM leave_requests WHERE employee_id = p_employee_id;
  DELETE FROM leave_balances WHERE employee_id = p_employee_id;
  DELETE FROM payslips WHERE employee_id = p_employee_id;
  DELETE FROM kudos WHERE from_employee_id = p_employee_id OR to_employee_id = p_employee_id;
  DELETE FROM employee_benefits WHERE employee_id = p_employee_id;
  DELETE FROM course_enrolments WHERE employee_id = p_employee_id;
  DELETE FROM performance_reviews WHERE employee_id = p_employee_id;
  DELETE FROM notifications WHERE employee_id = p_employee_id;
  DELETE FROM user_settings WHERE employee_id = p_employee_id;
  DELETE FROM one_to_one_comments WHERE meeting_id IN
    (SELECT id FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id);
  DELETE FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id;
  DELETE FROM space_bookings WHERE employee_id = p_employee_id;
  DELETE FROM timesheets WHERE employee_id = p_employee_id;
  DELETE FROM shift_assignments WHERE employee_id = p_employee_id;
  DELETE FROM onboarding WHERE employee_id = p_employee_id;
  DELETE FROM offboarding WHERE employee_id = p_employee_id;

  -- Tables with ON DELETE CASCADE — delete explicitly for completeness
  DELETE FROM employee_skills WHERE employee_id = p_employee_id;
  DELETE FROM skill_evidence WHERE employee_id = p_employee_id;
  DELETE FROM employee_certifications WHERE employee_id = p_employee_id;
  DELETE FROM employee_career_aspirations WHERE employee_id = p_employee_id;
  DELETE FROM skill_validations WHERE employee_id = p_employee_id;
  DELETE FROM employee_languages WHERE employee_id = p_employee_id;
  DELETE FROM break_records WHERE checkin_id IN
    (SELECT id FROM checkin_records WHERE employee_id = p_employee_id);
  DELETE FROM checkin_records WHERE employee_id = p_employee_id;
  DELETE FROM employee_documents WHERE employee_id = p_employee_id;
  DELETE FROM employee_consents WHERE employee_id = p_employee_id;
  DELETE FROM survey_responses WHERE employee_id = p_employee_id;
  DELETE FROM elearning_completions WHERE employee_id = p_employee_id;
  DELETE FROM elearning_progress WHERE employee_id = p_employee_id;
  DELETE FROM pay_period_reviews WHERE employee_id = p_employee_id;
  DELETE FROM shift_corrections WHERE employee_id = p_employee_id;
  DELETE FROM payroll_adjustments WHERE employee_id = p_employee_id;
  DELETE FROM modulr_payment_items WHERE employee_id = p_employee_id;
  DELETE FROM predictable_hours_requests WHERE employee_id = p_employee_id;
  DELETE FROM shift_cancellation_log WHERE employee_id = p_employee_id;
  DELETE FROM holiday_accrual_log WHERE employee_id = p_employee_id;
  DELETE FROM employee_shift_skills WHERE employee_id = p_employee_id;
  DELETE FROM admin_portal_access WHERE employee_id = p_employee_id;
  DELETE FROM user_preferences WHERE employee_id = p_employee_id;
  DELETE FROM legal_timesheet_timers WHERE employee_id = p_employee_id;
  DELETE FROM employee_custom_field_values WHERE employee_id = p_employee_id;
  DELETE FROM help_search_logs WHERE employee_id = p_employee_id;
  DELETE FROM ai_help_usage WHERE employee_id = p_employee_id;
  DELETE FROM sick_leave_episode_requests WHERE episode_id IN
    (SELECT id FROM sick_leave_episodes WHERE employee_id = p_employee_id);
  DELETE FROM sick_leave_episodes WHERE employee_id = p_employee_id;
  DELETE FROM payroll_audit_log WHERE employee_id = p_employee_id;

  -- Company users (login record)
  DELETE FROM company_users WHERE employee_id = p_employee_id;

  -- Frozen employees queue
  DELETE FROM frozen_employees WHERE employee_id = p_employee_id;

  -- Finally, delete the employee record itself
  DELETE FROM employees WHERE id = p_employee_id;

  -- Log the permanent deletion
  PERFORM log_gdpr_action(
    v_company_id, 'employees', p_employee_id::text, 'PERMANENT_DELETE',
    NULL, NULL, NULL,
    jsonb_build_object(
      'type', 'right_to_erasure',
      'article', 'Art. 17 GDPR',
      'certificate_ref', v_cert_ref,
      'employee_name', COALESCE(v_emp.first_name, '') || ' ' || COALESCE(v_emp.last_name, ''),
      'data_deleted', v_counts,
      'reason', 'Retention period expired — all data permanently deleted'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'employee_id', p_employee_id,
    'company_id', v_company_id,
    'certificate_ref', v_cert_ref,
    'data_deleted', v_counts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION delete_employee_permanently(uuid) TO authenticated;

-- ── G. Updated purge function ──────────────────────────────────────────
-- Runs daily via pg_cron. Calls delete_employee_permanently for each
-- expired frozen employee. Produces a deletion certificate per person.
CREATE OR REPLACE FUNCTION purge_expired_frozen_employees()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record record;
  v_count integer := 0;
  v_result jsonb;
BEGIN
  IF NOT (is_super_admin() OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'Only super admin can call this function';
  END IF;

  FOR v_record IN
    SELECT id, employee_id, company_id, employee_name
    FROM frozen_employees
    WHERE status = 'awaiting_expiry'
      AND (deletion_date + COALESCE(extension_days, 0) * INTERVAL '1 day') <= CURRENT_DATE
  LOOP
    BEGIN
      SELECT delete_employee_permanently(v_record.employee_id) INTO v_result;
    EXCEPTION WHEN OTHERS THEN
      PERFORM log_gdpr_action(
        v_record.company_id, 'frozen_employees', v_record.id::text, 'AUTO_PURGE_DELETE_FAILED',
        NULL, NULL, NULL,
        jsonb_build_object('employee_name', v_record.employee_name, 'error', SQLERRM)
      );
      CONTINUE;
    END;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION purge_expired_frozen_employees() TO authenticated;
