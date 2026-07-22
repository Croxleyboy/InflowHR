-- Add skipped_steps JSONB column to track which workflow steps were skipped per onboarder
ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS skipped_steps jsonb DEFAULT '{}'::jsonb;
