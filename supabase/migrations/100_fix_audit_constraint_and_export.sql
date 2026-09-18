-- CR-08: Add AUTO_PURGE to gdpr_audit_logs action constraint
-- The data retention cron logs with 'AUTO_PURGE' but the CHECK constraint
-- didn't include it, causing the cron to fail silently.

ALTER TABLE gdpr_audit_logs DROP CONSTRAINT IF EXISTS gdpr_audit_logs_action_check;
ALTER TABLE gdpr_audit_logs ADD CONSTRAINT gdpr_audit_logs_action_check
  CHECK (action IN (
    'SELECT', 'INSERT', 'UPDATE', 'DELETE',
    'EXPORT', 'ANONYMISE', 'GRANT_ACCESS', 'REVOKE_ACCESS',
    'SELF_GRANT_ACCESS', 'AUTO_PURGE'
  ));


-- CR-12: Fix export_company_data break_records query
-- r.checkin_id doesn't exist on break_records — the column is checkin_record_id
-- Also use company_id directly since break_records has its own company_id column

CREATE OR REPLACE FUNCTION export_company_data(p_company_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_company jsonb;
  v_company_name text;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;

  SELECT to_jsonb(c) INTO v_company FROM companies c WHERE c.id = p_company_id;

  SELECT jsonb_build_object(
    'export_metadata', jsonb_build_object(
      'format',        'InflowHR Company Export v1',
      'exported_at',   now(),
      'company_id',    p_company_id,
      'company_name',  v_company_name,
      'gdpr_article',  'Art. 28(3)(g) — Return or delete all personal data after services end',
      'export_type',   'cancellation'
    ),

    -- Core company data
    'company',              v_company,
    'employees',            COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employees            r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'company_users',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_users        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- HR data
    'leave_types',          COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_types          r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'leave_requests',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_requests       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'leave_balances',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_balances       r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Payroll
    'payslips',             COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM payslips             r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Expenses
    'expense_claims',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_claims       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'expense_line_items',   COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_line_items   r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Timesheets
    'timesheets',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM timesheets           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Performance
    'performance_reviews',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM performance_reviews  r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'kudos',                COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM kudos                r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Benefits
    'benefits',             COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefits             r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_types',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_types        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_options',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_options      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_enrollments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_enrollments  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'employee_benefits',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_benefits    r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    -- Shifts & rotas
    'rotas',                COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM rotas                r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_templates',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_templates      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_assignments',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_assignments    r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_swap_requests',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_swap_requests  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'employee_availability',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_availability r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Legal
    'legal_clients',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_clients        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'legal_matters',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_matters        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'legal_timesheet_entries', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_timesheet_entries r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Tickets
    'hr_tickets',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM hr_tickets           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Meetings
    'one_to_one_meetings',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_meetings  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'one_to_one_comments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_comments  r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Onboarding
    'onboarding',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM onboarding           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Announcements & notifications
    'announcements',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM announcements        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'notifications',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM notifications        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Workflow
    'workflow_tracker',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM workflow_tracker     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Settings & features
    'app_settings',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM app_settings         r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'company_features',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_features     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- E-learning
    'company_elearning_courses', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_elearning_courses r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'courses',              COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM courses              r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'course_enrolments',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM course_enrolments    r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    -- Check-in records (CR-12 fix: checkin_id → checkin_record_id)
    'checkin_records',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM checkin_records      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'break_records',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM break_records        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Space bookings
    'space_bookings',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM space_bookings       r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    -- Skills & certifications
    'employee_skills',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_skills      r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'employee_certifications', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_certifications r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'skill_evidence',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM skill_evidence       r WHERE r.employee_skill_id IN (SELECT id FROM employee_skills WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id))), '[]'::jsonb),
    'skill_validations',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM skill_validations    r WHERE r.employee_skill_id IN (SELECT id FROM employee_skills WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id))), '[]'::jsonb),

    -- Assets
    'company_assets',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_assets       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'asset_updates',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM asset_updates        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Employee consents
    'employee_consents',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_consents    r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Billing snapshots
    'billing_snapshots',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM billing_snapshots    r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- User settings
    'user_settings',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM user_settings        r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    -- GDPR audit trail (included for transparency)
    'gdpr_audit_logs',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM gdpr_audit_logs     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Support access history
    'tenant_support_access', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM tenant_support_access r WHERE r.company_id = p_company_id), '[]'::jsonb)
  ) INTO v_result;

  PERFORM log_gdpr_action(
    auth.uid(), 'super_admin', p_company_id,
    NULL, 'companies', p_company_id::text,
    'COMPANY_DATA_EXPORTED', NULL, NULL,
    jsonb_build_object(
      'export_type', 'cancellation',
      'gdpr_article', 'Art. 28(3)(g)'
    )
  );

  RETURN v_result;
END;
$$;
