-- 165: Fix delete_company_data — remove dropped work_patterns table,
-- add all tables created since migration 138.

CREATE OR REPLACE FUNCTION public.delete_company_data(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_name text;
  v_employee_ids uuid[];
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;
  SELECT array_agg(id) INTO v_employee_ids FROM employees WHERE company_id = p_company_id;

  -- Survey tables (child → parent order)
  DELETE FROM survey_responses    WHERE company_id = p_company_id;
  DELETE FROM survey_deployments  WHERE company_id = p_company_id;
  DELETE FROM company_surveys     WHERE company_id = p_company_id;

  -- Check-in tables
  DELETE FROM break_records       WHERE company_id = p_company_id;
  DELETE FROM checkin_records     WHERE company_id = p_company_id;
  DELETE FROM checkin_settings    WHERE company_id = p_company_id;
  DELETE FROM work_locations      WHERE company_id = p_company_id;

  -- Skills passport tables
  DELETE FROM skill_validations         WHERE company_id = p_company_id;
  DELETE FROM role_skill_requirements   WHERE company_id = p_company_id;
  DELETE FROM role_profiles             WHERE company_id = p_company_id;
  DELETE FROM employee_career_aspirations WHERE company_id = p_company_id;
  DELETE FROM skill_evidence            WHERE company_id = p_company_id;
  DELETE FROM employee_certifications   WHERE company_id = p_company_id;
  DELETE FROM employee_skills           WHERE company_id = p_company_id;
  DELETE FROM skills                    WHERE company_id = p_company_id;
  DELETE FROM skill_categories          WHERE company_id = p_company_id;

  -- Space booking tables
  DELETE FROM space_bookings    WHERE company_id = p_company_id;
  DELETE FROM space_settings    WHERE company_id = p_company_id;
  DELETE FROM spaces            WHERE company_id = p_company_id;
  DELETE FROM floors            WHERE company_id = p_company_id;
  DELETE FROM locations         WHERE company_id = p_company_id;

  -- Shift skills tables
  DELETE FROM employee_shift_skills  WHERE company_id = p_company_id;
  DELETE FROM shift_template_skills  WHERE company_id = p_company_id;
  DELETE FROM shift_skills           WHERE company_id = p_company_id;

  -- Integration tables
  DELETE FROM company_teams_bot_conversations WHERE company_id = p_company_id;
  DELETE FROM company_teams_config            WHERE company_id = p_company_id;
  DELETE FROM sage_integrations               WHERE company_id = p_company_id;
  DELETE FROM xero_integrations               WHERE company_id = p_company_id;
  DELETE FROM xero_earning_rate_mappings      WHERE company_id = p_company_id;
  DELETE FROM modulr_payment_items WHERE payment_id IN (SELECT id FROM modulr_payments WHERE company_id = p_company_id);
  DELETE FROM modulr_payments                 WHERE company_id = p_company_id;
  DELETE FROM modulr_integrations             WHERE company_id = p_company_id;

  -- Expense settings tables
  DELETE FROM expense_export_entries  WHERE company_id = p_company_id;
  DELETE FROM expense_cost_centers    WHERE company_id = p_company_id;
  DELETE FROM expense_expense_types   WHERE company_id = p_company_id;
  DELETE FROM expense_export_log      WHERE company_id = p_company_id;

  -- Employee-linked tables (use employee_ids for tables without company_id)
  DELETE FROM employee_documents  WHERE company_id = p_company_id;
  DELETE FROM employee_languages  WHERE company_id = p_company_id;
  DELETE FROM employee_consents   WHERE company_id = p_company_id;

  -- Offboarding / cancellation
  DELETE FROM offboarding           WHERE company_id = p_company_id;
  DELETE FROM frozen_employees      WHERE company_id = p_company_id;
  DELETE FROM cancellation_requests WHERE company_id = p_company_id;

  -- Performance goals
  DELETE FROM performance_goal_comments WHERE company_id = p_company_id;
  DELETE FROM performance_goals         WHERE company_id = p_company_id;

  -- Labour demand (table may not exist on all environments)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'labour_demand_forecasts') THEN
    DELETE FROM labour_demand_forecasts WHERE company_id = p_company_id;
  END IF;

  -- Asset updates
  DELETE FROM asset_updates WHERE company_id = p_company_id;

  -- Billing snapshots
  DELETE FROM billing_snapshots WHERE company_id = p_company_id;

  -- Admin portal access
  DELETE FROM admin_portal_access WHERE company_id = p_company_id;

  -- Email notification settings
  DELETE FROM email_notification_settings WHERE company_id = p_company_id;

  -- Customer projects
  DELETE FROM customer_projects WHERE company_id = p_company_id;

  -- E-learning
  DELETE FROM elearning_completions      WHERE company_id = p_company_id;
  DELETE FROM company_elearning_courses  WHERE company_id = p_company_id;

  -- GDPR / support
  DELETE FROM gdpr_audit_logs        WHERE company_id = p_company_id;
  DELETE FROM tenant_support_access  WHERE company_id = p_company_id;

  -- Benefits tables
  DELETE FROM benefit_enrollments WHERE company_id = p_company_id;
  DELETE FROM benefit_options     WHERE company_id = p_company_id;
  DELETE FROM benefit_types       WHERE company_id = p_company_id;

  -- Shift tables
  DELETE FROM shift_corrections     WHERE company_id = p_company_id;
  DELETE FROM shift_swap_requests   WHERE company_id = p_company_id;
  DELETE FROM shift_assignments     WHERE company_id = p_company_id;
  DELETE FROM shift_templates       WHERE company_id = p_company_id;
  DELETE FROM rotas                 WHERE company_id = p_company_id;
  DELETE FROM employee_availability WHERE company_id = p_company_id;

  -- Legal timesheets & invoicing (invoice_lines has no company_id — cascades via invoice FK)
  DELETE FROM legal_invoice_lines WHERE invoice_id IN (SELECT id FROM legal_invoices WHERE company_id = p_company_id);
  DELETE FROM legal_invoices           WHERE company_id = p_company_id;
  DELETE FROM legal_timesheet_entries  WHERE company_id = p_company_id;
  DELETE FROM legal_matters            WHERE company_id = p_company_id;
  DELETE FROM legal_clients            WHERE company_id = p_company_id;

  -- HR tickets
  DELETE FROM hr_tickets WHERE company_id = p_company_id;

  -- One-to-one meetings
  DELETE FROM one_to_one_comments WHERE company_id = p_company_id;
  DELETE FROM one_to_one_meetings WHERE company_id = p_company_id;

  -- Payroll tables (pay_runs before payslips due to FK)
  DELETE FROM payroll_audit_log    WHERE company_id = p_company_id;
  DELETE FROM payroll_exports      WHERE company_id = p_company_id;
  DELETE FROM pay_period_reviews   WHERE company_id = p_company_id;

  -- Worker type settings
  DELETE FROM worker_setting_change_log WHERE company_id = p_company_id;
  DELETE FROM worker_type_settings      WHERE company_id = p_company_id;

  -- Core operational tables
  DELETE FROM workflow_tracker    WHERE company_id = p_company_id;
  DELETE FROM notifications       WHERE company_id = p_company_id;
  DELETE FROM timesheets          WHERE company_id = p_company_id;
  DELETE FROM expense_line_items  WHERE company_id = p_company_id;
  DELETE FROM expense_claims      WHERE company_id = p_company_id;
  DELETE FROM leave_requests      WHERE company_id = p_company_id;
  DELETE FROM leave_balances      WHERE company_id = p_company_id;
  DELETE FROM kudos               WHERE company_id = p_company_id;
  DELETE FROM payslips            WHERE company_id = p_company_id;
  DELETE FROM pay_runs            WHERE company_id = p_company_id;
  DELETE FROM onboarding          WHERE company_id = p_company_id;
  DELETE FROM announcements       WHERE company_id = p_company_id;

  -- Employee-linked tables without company_id column
  IF v_employee_ids IS NOT NULL THEN
    DELETE FROM course_enrolments   WHERE employee_id = ANY(v_employee_ids);
    DELETE FROM employee_benefits   WHERE employee_id = ANY(v_employee_ids);
    DELETE FROM performance_reviews WHERE employee_id = ANY(v_employee_ids);
    DELETE FROM user_settings       WHERE employee_id = ANY(v_employee_ids);
  END IF;

  -- Company config tables
  DELETE FROM app_settings     WHERE company_id = p_company_id;
  DELETE FROM company_features WHERE company_id = p_company_id;
  DELETE FROM benefits         WHERE company_id = p_company_id;
  DELETE FROM courses          WHERE company_id = p_company_id;

  -- Company users and employees (must come before companies)
  DELETE FROM company_users WHERE company_id = p_company_id;
  DELETE FROM employees     WHERE company_id = p_company_id;
  DELETE FROM leave_types   WHERE company_id = p_company_id;

  -- Finally delete the company itself
  DELETE FROM companies WHERE id = p_company_id;

  RETURN 'Deleted all data for company: ' || v_company_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_company_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_company_data(uuid) TO authenticated;
