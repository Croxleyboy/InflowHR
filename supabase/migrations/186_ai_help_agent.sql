-- Migration 186: AI Help Agent
-- Adds AI tracking to search logs and rate-limiting table

-- ── Track AI-generated responses in search logs ─────────────────────────────
ALTER TABLE help_search_logs ADD COLUMN ai_generated BOOLEAN NOT NULL DEFAULT false;

-- ── Rate limiting: track AI queries per employee per day ─────────────────────
CREATE TABLE ai_help_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  query_date DATE NOT NULL DEFAULT CURRENT_DATE,
  query_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, employee_id, query_date)
);

ALTER TABLE ai_help_usage ENABLE ROW LEVEL SECURITY;

-- Service-role only — edge function writes via service role key
CREATE POLICY "Service role only" ON ai_help_usage
  FOR ALL USING (false);

-- ── Update delete_company_data to clean up ───────────────────────────────────
DROP FUNCTION IF EXISTS delete_company_data(UUID);
CREATE OR REPLACE FUNCTION delete_company_data(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can delete company data';
  END IF;

  DELETE FROM ai_help_usage WHERE company_id = p_company_id;
  DELETE FROM help_search_logs WHERE company_id = p_company_id;
  DELETE FROM help_articles WHERE company_id = p_company_id;
  DELETE FROM survey_responses WHERE survey_id IN (SELECT id FROM surveys WHERE company_id = p_company_id);
  DELETE FROM survey_questions WHERE survey_id IN (SELECT id FROM surveys WHERE company_id = p_company_id);
  DELETE FROM surveys WHERE company_id = p_company_id;
  DELETE FROM shift_corrections WHERE company_id = p_company_id;
  DELETE FROM shift_swap_requests WHERE company_id = p_company_id;
  DELETE FROM shift_assignments WHERE company_id = p_company_id;
  DELETE FROM shift_templates WHERE company_id = p_company_id;
  DELETE FROM rotas WHERE company_id = p_company_id;
  DELETE FROM payroll_audit_log WHERE company_id = p_company_id;
  DELETE FROM payslips WHERE company_id = p_company_id;
  DELETE FROM timesheet_entries WHERE company_id = p_company_id;
  DELETE FROM timesheets WHERE company_id = p_company_id;
  DELETE FROM check_in_records WHERE company_id = p_company_id;
  DELETE FROM check_in_policies WHERE company_id = p_company_id;
  DELETE FROM leave_requests WHERE company_id = p_company_id;
  DELETE FROM leave_balances WHERE company_id = p_company_id;
  DELETE FROM leave_types WHERE company_id = p_company_id;
  DELETE FROM expense_claims WHERE company_id = p_company_id;
  DELETE FROM expense_categories WHERE company_id = p_company_id;
  DELETE FROM performance_reviews WHERE company_id = p_company_id;
  DELETE FROM review_cycles WHERE company_id = p_company_id;
  DELETE FROM objectives WHERE company_id = p_company_id;
  DELETE FROM kudos WHERE company_id = p_company_id;
  DELETE FROM elearning_enrolments WHERE company_id = p_company_id;
  DELETE FROM elearning_courses WHERE company_id = p_company_id;
  DELETE FROM elearning_categories WHERE company_id = p_company_id;
  DELETE FROM benefit_enrolments WHERE company_id = p_company_id;
  DELETE FROM benefit_types WHERE company_id = p_company_id;
  DELETE FROM space_bookings WHERE company_id = p_company_id;
  DELETE FROM space_equipment WHERE company_id = p_company_id;
  DELETE FROM spaces WHERE company_id = p_company_id;
  DELETE FROM assets WHERE company_id = p_company_id;
  DELETE FROM asset_categories WHERE company_id = p_company_id;
  DELETE FROM skill_endorsements WHERE company_id = p_company_id;
  DELETE FROM employee_skills WHERE company_id = p_company_id;
  DELETE FROM skill_categories WHERE company_id = p_company_id;
  DELETE FROM employee_consents WHERE company_id = p_company_id;
  DELETE FROM notifications WHERE company_id = p_company_id;
  DELETE FROM onboarding_tasks WHERE company_id = p_company_id;
  DELETE FROM documents WHERE company_id = p_company_id;
  DELETE FROM company_teams_config WHERE company_id = p_company_id;
  DELETE FROM xero_integrations WHERE company_id = p_company_id;
  DELETE FROM sage_integrations WHERE company_id = p_company_id;
  DELETE FROM modulr_integrations WHERE company_id = p_company_id;
  DELETE FROM zero_hours_config WHERE company_id = p_company_id;
  DELETE FROM zero_hours_assessments WHERE company_id = p_company_id;
  DELETE FROM onboarding_workflow_settings WHERE company_id = p_company_id;
  DELETE FROM company_features WHERE company_id = p_company_id;
  DELETE FROM employees WHERE company_id = p_company_id;
  DELETE FROM company_users WHERE company_id = p_company_id;
  DELETE FROM companies WHERE id = p_company_id;
END;
$$;
