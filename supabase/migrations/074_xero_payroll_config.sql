-- Migration 074: Xero Payroll integration
-- Stores per-company OAuth tokens and sync state.
-- Client ID / Secret / Redirect URI live in Edge Function env vars, NOT in the DB.

CREATE TABLE IF NOT EXISTS xero_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  access_token    text,
  refresh_token   text,
  tenant_id       text,
  expires_at      timestamptz,
  last_sync_at    timestamptz,
  sync_status     text NOT NULL DEFAULT 'not_connected'
                  CHECK (sync_status IN ('not_connected','connected','syncing','error')),
  sync_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xero_int_company ON xero_integrations(company_id);

ALTER TABLE xero_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Xero - company read" ON xero_integrations
  FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Xero - company insert" ON xero_integrations
  FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Xero - company update" ON xero_integrations
  FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Xero - company delete" ON xero_integrations
  FOR DELETE USING (can_access_company(company_id));

-- Add source tracking to payslips for dedup on sync
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS xero_payslip_id text;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS source text DEFAULT 'inflowhr'
  CHECK (source IN ('inflowhr', 'xero'));
CREATE INDEX IF NOT EXISTS idx_payslips_xero_id
  ON payslips(xero_payslip_id) WHERE xero_payslip_id IS NOT NULL;
