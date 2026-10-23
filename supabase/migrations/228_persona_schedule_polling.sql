-- Add persona schedule polling columns to mover_m365_actions
-- Stores full engine schedule state for status display, polling, and notifications

ALTER TABLE mover_m365_actions
  ADD COLUMN IF NOT EXISTS persona_pre_check JSONB,
  ADD COLUMN IF NOT EXISTS persona_next_actions TEXT[],
  ADD COLUMN IF NOT EXISTS persona_schedule_message TEXT,
  ADD COLUMN IF NOT EXISTS persona_schedule_stages JSONB,
  ADD COLUMN IF NOT EXISTS persona_schedule_next_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS persona_schedule_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS persona_last_notified_status TEXT;

-- Rollback:
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS persona_pre_check;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS persona_next_actions;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS persona_schedule_message;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS persona_schedule_stages;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS persona_schedule_next_due_at;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS persona_schedule_updated_at;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS persona_last_notified_status;
