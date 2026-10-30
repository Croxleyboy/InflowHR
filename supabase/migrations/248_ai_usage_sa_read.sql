-- Migration 248: Allow super admins to read AI usage data
-- The ai_help_usage table currently has RLS "FOR ALL USING (false)"
-- which blocks the SA dashboard from reading query/token counts.

CREATE POLICY "Super admins can read ai_help_usage"
  ON ai_help_usage
  FOR SELECT
  USING (is_super_admin());
