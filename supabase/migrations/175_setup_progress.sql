-- Add setup_progress JSONB column to companies for tracking Getting Setup checklist
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS setup_progress JSONB DEFAULT '{}'::jsonb;
