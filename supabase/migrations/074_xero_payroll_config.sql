-- Migration 074: Xero Payroll integration config
-- Stores per-company Xero OAuth credentials and sync state

CREATE TABLE IF NOT EXISTS company_xero_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  is_enabled      boolean NOT NULL DEFAULT false,
  client_id       text NOT NULL DEFAULT '',
  client_secret   text NOT NULL DEFAULT '',
  tenant_id       text NOT NULL DEFAULT '',
  redirect_uri    text NOT NULL DEFAULT '',
  access_token    text,
  refresh_token   text,
  token_expires_at timestamptz,
  last_sync_at    timestamptz,
  sync_status     text DEFAULT 'not_connected'
                  CHECK (sync_status IN ('not_connected','connected','syncing','error')),
  sync_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xero_config_company ON company_xero_config(company_id);

ALTER TABLE company_xero_config ENABLE ROW LEVEL SECURITY;

-- Company admins can manage their own Xero config
CREATE POLICY "Xero config - company scoped read" ON company_xero_config
  FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Xero config - company scoped insert" ON company_xero_config
  FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Xero config - company scoped update" ON company_xero_config
  FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Xero config - company scoped delete" ON company_xero_config
  FOR DELETE USING (can_access_company(company_id));

-- Add xero_payslip_id to payslips for dedup on sync
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS xero_payslip_id text;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS source text DEFAULT 'inflowhr'
  CHECK (source IN ('inflowhr', 'xero'));
CREATE INDEX IF NOT EXISTS idx_payslips_xero_id ON payslips(xero_payslip_id) WHERE xero_payslip_id IS NOT NULL;
