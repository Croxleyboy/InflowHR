-- 215: M365 Scheduling — scheduled joiner & leaver provisioning
-- Adds feature flag, schedule columns, template cache, and webhook config

-- 1a. Feature flag
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
VALUES ('m365_scheduling', 'M365 Scheduling', 'Schedule M365 account provisioning and deprovisioning ahead of joiner/leaver dates', 0, true, true)
ON CONFLICT (feature_key) DO NOTHING;

-- 1b. Template cache + webhook config on inflowonboarder_integrations
ALTER TABLE inflowonboarder_integrations
  ADD COLUMN IF NOT EXISTS schedule_templates_cache jsonb,
  ADD COLUMN IF NOT EXISTS schedule_templates_cached_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_id text,
  ADD COLUMN IF NOT EXISTS webhook_secret text;

-- 1c. Schedule columns on onboarding_m365_actions
ALTER TABLE onboarding_m365_actions
  ADD COLUMN IF NOT EXISTS schedule_id text,
  ADD COLUMN IF NOT EXISTS schedule_status text,
  ADD COLUMN IF NOT EXISTS schedule_message text,
  ADD COLUMN IF NOT EXISTS schedule_stages jsonb,
  ADD COLUMN IF NOT EXISTS schedule_next_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_options jsonb;

-- 1d. Schedule columns on offboarding_m365_actions
ALTER TABLE offboarding_m365_actions
  ADD COLUMN IF NOT EXISTS schedule_id text,
  ADD COLUMN IF NOT EXISTS schedule_status text,
  ADD COLUMN IF NOT EXISTS schedule_message text,
  ADD COLUMN IF NOT EXISTS schedule_stages jsonb,
  ADD COLUMN IF NOT EXISTS schedule_next_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_options jsonb;

-- 1e. Add schedule_status CHECK constraints
ALTER TABLE onboarding_m365_actions
  ADD CONSTRAINT onboarding_m365_schedule_status_check
  CHECK (schedule_status IS NULL OR schedule_status IN (
    'pending_approval','scheduled','running','blocked','completed','cancelled','failed','missed'
  ));

ALTER TABLE offboarding_m365_actions
  ADD CONSTRAINT offboarding_m365_schedule_status_check
  CHECK (schedule_status IS NULL OR schedule_status IN (
    'pending_approval','scheduled','running','blocked','completed','cancelled','failed','missed'
  ));
