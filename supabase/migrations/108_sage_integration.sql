-- ── 108: Sage Payroll Integration + Integration Feature Flags ──────────────────
-- Adds sage_integrations table (mirrors xero_integrations pattern),
-- adds xero_integration and sage_integration feature flags,
-- and extends payslips.source to support 'sage'.
-- All data isolated per company via company_id + RLS.

-- ── sage_integrations table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sage_integrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id text,
  client_secret_encrypted text,
  access_token text,
  refresh_token text,
  resource_owner_id text,
  expires_at timestamptz,
  sync_status text NOT NULL DEFAULT 'not_connected'
    CHECK (sync_status IN ('not_connected', 'connected', 'syncing', 'error')),
  sync_error text,
  last_sync_at timestamptz,
  payslip_source text NOT NULL DEFAULT 'inflowhr'
    CHECK (payslip_source IN ('inflowhr', 'sage')),
  cached_pay_run jsonb,
  cached_payslips jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT sage_integrations_company_unique UNIQUE (company_id)
);

ALTER TABLE sage_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users can read own sage_integrations"
  ON sage_integrations FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Admins can insert sage_integrations"
  ON sage_integrations FOR INSERT
  WITH CHECK (company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM company_users WHERE auth_user_id = auth.uid() AND company_id = sage_integrations.company_id AND role IN ('admin','hr')));

CREATE POLICY "Admins can update sage_integrations"
  ON sage_integrations FOR UPDATE
  USING (company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM company_users WHERE auth_user_id = auth.uid() AND company_id = sage_integrations.company_id AND role IN ('admin','hr')));

CREATE POLICY "Admins can delete sage_integrations"
  ON sage_integrations FOR DELETE
  USING (company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM company_users WHERE auth_user_id = auth.uid() AND company_id = sage_integrations.company_id AND role = 'admin'));

-- ── Add xero_integration and sage_integration feature flags ────────────────────
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
VALUES
  ('xero_integration', 'Xero Integration', 'Connect Xero Payroll to sync payslip data automatically', 0, true, true),
  ('sage_integration', 'Sage Integration', 'Connect Sage Payroll to sync payslip data automatically', 0, true, true)
ON CONFLICT (feature_key) DO NOTHING;

-- ── GDPR: log token storage/refresh as sensitive data operations ───────────────
-- Tokens are credentials — log when they are created, refreshed, or revoked.
-- This is enforced in the edge functions (sage-connect, sage-callback, sage-payslips)
-- via log_gdpr_action() calls with action 'GRANT_ACCESS' / 'REVOKE_ACCESS'.

-- ── Ensure payslips.source supports 'sage' ─────────────────────────────────────
-- The source column is text with no CHECK constraint, so 'sage' values are accepted.
-- No schema change needed — just documenting the convention:
--   source = NULL or '' → InflowHR native
--   source = 'xero'    → Xero integration
--   source = 'sage'    → Sage integration
