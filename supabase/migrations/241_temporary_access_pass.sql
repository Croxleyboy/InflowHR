-- Migration 241: Temporary Access Pass (TAP) support
-- Adds pass metadata columns to onboarding_m365_actions (never stores the pass itself)
-- Adds passes readiness columns to inflowonboarder_integrations

-- 1a. Pass metadata on onboarding_m365_actions
ALTER TABLE onboarding_m365_actions
  ADD COLUMN IF NOT EXISTS pass_id TEXT,
  ADD COLUMN IF NOT EXISTS pass_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pass_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pass_viewed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS pass_status TEXT DEFAULT NULL
    CHECK (pass_status IS NULL OR pass_status IN ('pending','ready','viewed','expired','gone','error'));

-- 1b. Passes readiness on inflowonboarder_integrations
ALTER TABLE inflowonboarder_integrations
  ADD COLUMN IF NOT EXISTS passes_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS passes_ready BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS passes_status_detail TEXT;

-- Rollback:
--   ALTER TABLE onboarding_m365_actions DROP COLUMN IF EXISTS pass_id, DROP COLUMN IF EXISTS pass_expires_at, DROP COLUMN IF EXISTS pass_viewed_at, DROP COLUMN IF EXISTS pass_viewed_by, DROP COLUMN IF EXISTS pass_status;
--   ALTER TABLE inflowonboarder_integrations DROP COLUMN IF EXISTS passes_enabled, DROP COLUMN IF EXISTS passes_ready, DROP COLUMN IF EXISTS passes_status_detail;
