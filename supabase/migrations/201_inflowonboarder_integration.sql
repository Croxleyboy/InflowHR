-- InflowOnboarder integration — Microsoft 365 account provisioning in onboarding
-- Designed for easy backout: DROP TABLE + remove feature rows to revert

-- ============================================================
-- 1. Integration config table (per-company)
-- ============================================================
CREATE TABLE IF NOT EXISTS inflowonboarder_integrations (
  company_id    uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  api_key_encrypted  text NOT NULL,
  api_key_iv         text NOT NULL,
  api_key_hint       text NOT NULL,        -- last 4 chars: ifo_…abcd
  status             text NOT NULL DEFAULT 'not_connected'
    CHECK (status IN ('not_connected','connected_ready','connected_not_ready','needs_attention')),
  status_detail      jsonb DEFAULT '{}',   -- { connections: [...], missing: [...] }
  status_checked_at  timestamptz,
  connected_at       timestamptz,
  connected_by       uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inflowonboarder_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ifo_select" ON inflowonboarder_integrations
  FOR SELECT USING (
    company_id = get_my_company_id() OR is_super_admin()
  );

CREATE POLICY "ifo_insert" ON inflowonboarder_integrations
  FOR INSERT WITH CHECK (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "ifo_update" ON inflowonboarder_integrations
  FOR UPDATE USING (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "ifo_delete" ON inflowonboarder_integrations
  FOR DELETE USING (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

-- ============================================================
-- 2. M365 actions per onboarding record
-- ============================================================
CREATE TABLE IF NOT EXISTS onboarding_m365_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id         integer NOT NULL REFERENCES onboarding(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Create account action
  create_account_job_id   text,
  create_account_status   text DEFAULT 'pending'
    CHECK (create_account_status IN ('pending','queued','running','succeeded','failed')),
  create_account_error    jsonb,
  m365_user_id            text,
  m365_upn                text,
  attempt_count_create    integer NOT NULL DEFAULT 0,

  -- Licence action
  licence_job_id          text,
  licence_status          text DEFAULT 'pending'
    CHECK (licence_status IN ('pending','queued','running','succeeded','failed')),
  licence_error           jsonb,
  licence_sku_id          text,
  licence_flag            text CHECK (licence_flag IS NULL OR licence_flag IN ('licence_needed')),
  attempt_count_licence   integer NOT NULL DEFAULT 0,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (onboarding_id)
);

ALTER TABLE onboarding_m365_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "m365_select" ON onboarding_m365_actions
  FOR SELECT USING (
    company_id = get_my_company_id() OR is_super_admin()
  );

CREATE POLICY "m365_insert" ON onboarding_m365_actions
  FOR INSERT WITH CHECK (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "m365_update" ON onboarding_m365_actions
  FOR UPDATE USING (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "m365_delete" ON onboarding_m365_actions
  FOR DELETE USING (is_super_admin());

-- ============================================================
-- 3. Feature flag + subscription pricing
-- ============================================================
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
VALUES ('inflowonboarder_integration', 'InflowOnboarder', 'Automate Microsoft 365 account provisioning during onboarding', 0, true, true)
ON CONFLICT (feature_key) DO NOTHING;

-- ============================================================
-- Backout SQL (run to fully revert):
--   DROP TABLE IF EXISTS onboarding_m365_actions;
--   DROP TABLE IF EXISTS inflowonboarder_integrations;
--   DELETE FROM subscription_pricing WHERE feature_key = 'inflowonboarder_integration';
--   DELETE FROM company_features WHERE feature_key = 'inflowonboarder_integration';
-- ============================================================
