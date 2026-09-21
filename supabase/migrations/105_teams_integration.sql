-- Migration 105: Teams Integration add-on
-- Adds teams_integration as a billable feature add-on (£1.50/user/month)
-- and a per-company config table for company admins to enable/disable.

-- ============================================================
-- 1. Subscription pricing row
-- ============================================================

INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
VALUES ('teams_integration', 'Teams Integration', 'Microsoft Teams presence in HR Directory and automated leave request notifications to managers via Teams', 1.50, true, true)
ON CONFLICT (feature_key) DO NOTHING;


-- ============================================================
-- 2. Company Teams config table
-- ============================================================

CREATE TABLE IF NOT EXISTS company_teams_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  consent_granted BOOLEAN NOT NULL DEFAULT FALSE,
  consent_granted_by UUID REFERENCES auth.users(id),
  consent_granted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id)
);

ALTER TABLE company_teams_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can read own teams config"
  ON company_teams_config FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Company admins can manage own teams config"
  ON company_teams_config FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Company admins can update own teams config"
  ON company_teams_config FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Company admins can delete own teams config"
  ON company_teams_config FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());
