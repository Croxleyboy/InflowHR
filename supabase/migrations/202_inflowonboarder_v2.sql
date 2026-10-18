-- InflowOnboarder v2: workflow-run lifecycle, onboarding settings, approval columns
-- Upgrades the v1 direct-action model to a single engine workflow run per starter

BEGIN;

-- A. Onboarding settings on inflowonboarder_integrations
ALTER TABLE inflowonboarder_integrations
  ADD COLUMN IF NOT EXISTS approver_mode text DEFAULT 'manager' CHECK (approver_mode IN ('nominated', 'manager')),
  ADD COLUMN IF NOT EXISTS approver_name text,
  ADD COLUMN IF NOT EXISTS approver_email text,
  ADD COLUMN IF NOT EXISTS licence_manager_name text,
  ADD COLUMN IF NOT EXISTS licence_manager_email text,
  ADD COLUMN IF NOT EXISTS licence_sku_id text,
  ADD COLUMN IF NOT EXISTS licence_sku_name text,
  ADD COLUMN IF NOT EXISTS group_name text,
  ADD COLUMN IF NOT EXISTS account_domain text,
  ADD COLUMN IF NOT EXISTS settings_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS settings_updated_by uuid REFERENCES auth.users(id);

-- B. Workflow run tracking on onboarding_m365_actions
ALTER TABLE onboarding_m365_actions
  ADD COLUMN IF NOT EXISTS run_id text,
  ADD COLUMN IF NOT EXISTS run_status text CHECK (run_status IN (
    'checking_licence', 'licence_unavailable', 'ready_for_approval',
    'awaiting_approval', 'provisioning', 'completed', 'failed'
  )),
  ADD COLUMN IF NOT EXISTS run_error jsonb,
  ADD COLUMN IF NOT EXISTS run_result jsonb,
  ADD COLUMN IF NOT EXISTS approval_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_status text CHECK (approval_status IN ('pending', 'approved', 'declined')),
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count_run integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_v1_legacy boolean NOT NULL DEFAULT false;

-- C. Mark existing v1 rows as legacy
UPDATE onboarding_m365_actions SET is_v1_legacy = true WHERE create_account_job_id IS NOT NULL;

COMMIT;

-- Backout SQL (run to revert v2 columns only):
-- ALTER TABLE inflowonboarder_integrations
--   DROP COLUMN IF EXISTS approver_mode,
--   DROP COLUMN IF EXISTS approver_name,
--   DROP COLUMN IF EXISTS approver_email,
--   DROP COLUMN IF EXISTS licence_manager_name,
--   DROP COLUMN IF EXISTS licence_manager_email,
--   DROP COLUMN IF EXISTS licence_sku_id,
--   DROP COLUMN IF EXISTS licence_sku_name,
--   DROP COLUMN IF EXISTS group_name,
--   DROP COLUMN IF EXISTS account_domain,
--   DROP COLUMN IF EXISTS settings_updated_at,
--   DROP COLUMN IF EXISTS settings_updated_by;
-- ALTER TABLE onboarding_m365_actions
--   DROP COLUMN IF EXISTS run_id,
--   DROP COLUMN IF EXISTS run_status,
--   DROP COLUMN IF EXISTS run_error,
--   DROP COLUMN IF EXISTS run_result,
--   DROP COLUMN IF EXISTS approval_sent_at,
--   DROP COLUMN IF EXISTS approval_status,
--   DROP COLUMN IF EXISTS approved_by,
--   DROP COLUMN IF EXISTS approved_at,
--   DROP COLUMN IF EXISTS attempt_count_run,
--   DROP COLUMN IF EXISTS is_v1_legacy;
