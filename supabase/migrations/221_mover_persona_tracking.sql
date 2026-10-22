-- Add persona tracking columns to mover_m365_actions
ALTER TABLE mover_m365_actions
  ADD COLUMN IF NOT EXISTS persona_check_result JSONB,
  ADD COLUMN IF NOT EXISTS persona_schedule_id TEXT,
  ADD COLUMN IF NOT EXISTS persona_schedule_status TEXT
    CHECK (persona_schedule_status IN ('pending_approval','scheduled','running','blocked','completed','cancelled','failed','missed'));
