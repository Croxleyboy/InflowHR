-- ── Xero timesheet push tracking ─────────────────────────────────────────────
-- Adds columns to track which period reviews have been pushed to Xero as
-- timesheets, and stores the payroll calendar mapping per Xero connection.

-- Track Xero timesheet ID on period reviews so we can update rather than duplicate
ALTER TABLE pay_period_reviews ADD COLUMN IF NOT EXISTS xero_timesheet_id text;
ALTER TABLE pay_period_reviews ADD COLUMN IF NOT EXISTS xero_pushed_at timestamptz;

-- Store the Xero payroll calendar ID for this company's integration
ALTER TABLE xero_integrations ADD COLUMN IF NOT EXISTS payroll_calendar_id text;

-- Store earning rate mappings between InflowHR rate names and Xero earning rate IDs
CREATE TABLE IF NOT EXISTS xero_earning_rate_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inflow_rate_name      text NOT NULL,
  xero_earnings_rate_id text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, inflow_rate_name)
);

ALTER TABLE xero_earning_rate_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "xerm_select" ON xero_earning_rate_mappings FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "xerm_insert" ON xero_earning_rate_mappings FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "xerm_update" ON xero_earning_rate_mappings FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "xerm_delete" ON xero_earning_rate_mappings FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());
