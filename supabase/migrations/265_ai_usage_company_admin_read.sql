-- Migration 265: Allow company admins to read their own company's ai_help_usage rows
-- Previously only super admins could read this table (migration 248).
-- Company admins need visibility for the dashboard card and employee query log.

CREATE POLICY "Company admins can read ai_help_usage"
  ON ai_help_usage
  FOR SELECT
  USING (company_id = get_my_company_id() AND is_company_admin());
