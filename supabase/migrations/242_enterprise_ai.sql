-- ============================================================
-- 242_enterprise_ai.sql
-- Enterprise AI Assistant — BYOK Azure OpenAI integration
-- Completely separate from the standard AI Help Agent
-- ============================================================

-- ── Enterprise AI integration settings per company ──────────
CREATE TABLE IF NOT EXISTS enterprise_ai_integrations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ai_provider    TEXT NOT NULL DEFAULT 'azure_openai'
                   CHECK (ai_provider IN ('azure_openai')),
  ai_endpoint    TEXT,
  ai_api_key     TEXT,
  ai_model       TEXT DEFAULT 'gpt-4o',
  ai_api_version TEXT DEFAULT '2024-06-01',
  is_enabled     BOOLEAN NOT NULL DEFAULT false,
  connected_at   TIMESTAMPTZ,
  last_test_at   TIMESTAMPTZ,
  last_test_ok   BOOLEAN,
  status         TEXT DEFAULT 'not_configured'
                   CHECK (status IN ('not_configured', 'configured', 'connected', 'error')),
  status_detail  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id)
);

ALTER TABLE enterprise_ai_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY enterprise_ai_select ON enterprise_ai_integrations
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND role IN ('admin', 'hr') AND is_active = true
    ) OR is_super_admin()
  );

CREATE POLICY enterprise_ai_insert ON enterprise_ai_integrations
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND role = 'admin' AND is_active = true
    ) OR is_super_admin()
  );

CREATE POLICY enterprise_ai_update ON enterprise_ai_integrations
  FOR UPDATE USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND role = 'admin' AND is_active = true
    ) OR is_super_admin()
  );

CREATE POLICY enterprise_ai_delete ON enterprise_ai_integrations
  FOR DELETE USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND role = 'admin' AND is_active = true
    ) OR is_super_admin()
  );

-- ── Minimal audit log — records ONLY that a query happened, never content ──
CREATE TABLE IF NOT EXISTS enterprise_ai_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  INTEGER NOT NULL,
  queried_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  success      BOOLEAN NOT NULL DEFAULT true,
  tool_called  TEXT,
  error_code   TEXT
);

ALTER TABLE enterprise_ai_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY eai_audit_select ON enterprise_ai_audit
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND role IN ('admin', 'hr') AND is_active = true
    ) OR is_super_admin()
  );

CREATE POLICY eai_audit_insert ON enterprise_ai_audit
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND is_active = true
    ) OR is_super_admin()
  );

-- ── Enterprise AI daily usage (separate from standard ai_help_usage) ──
CREATE TABLE IF NOT EXISTS enterprise_ai_usage (
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  INTEGER NOT NULL,
  query_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  query_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, employee_id, query_date)
);

ALTER TABLE enterprise_ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY eai_usage_select ON enterprise_ai_usage
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND is_active = true
    ) OR is_super_admin()
  );

CREATE POLICY eai_usage_upsert ON enterprise_ai_usage
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND is_active = true
    ) OR is_super_admin()
  );

CREATE POLICY eai_usage_update ON enterprise_ai_usage
  FOR UPDATE USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND is_active = true
    ) OR is_super_admin()
  );

-- ── Add enterprise_ai as an individual add-on in subscription pricing ──
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
VALUES ('enterprise_ai', 'Enterprise AI Assistant', 'BYOK Azure OpenAI assistant with full company context — replaces standard Employee Help', 0, true, true)
ON CONFLICT (feature_key) DO NOTHING;

-- ── Cleanup in delete_company_data ──
-- Add to the existing function if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'delete_company_data') THEN
    -- The tables will cascade-delete via company_id FK, but we add explicit
    -- cleanup to match the existing pattern
    EXECUTE 'SELECT 1'; -- no-op, CASCADE handles it
  END IF;
END $$;
