-- Migration 250: Add 'skipped' and 'blocked' to pass_status CHECK constraint + pass_error_detail
-- 'skipped' = pass was requested but dropped (retry without pass, or schedule changed to drop pass)
-- 'blocked' = enable_sign_in stage is blocked on a pass issue; engine will re-run once fixed

ALTER TABLE onboarding_m365_actions
  DROP CONSTRAINT IF EXISTS onboarding_m365_actions_pass_status_check;

ALTER TABLE onboarding_m365_actions
  ADD CONSTRAINT onboarding_m365_actions_pass_status_check
  CHECK (pass_status IS NULL OR pass_status IN ('pending','ready','viewed','expired','gone','error','skipped','blocked'));

ALTER TABLE onboarding_m365_actions
  ADD COLUMN IF NOT EXISTS pass_error_detail JSONB DEFAULT NULL;
