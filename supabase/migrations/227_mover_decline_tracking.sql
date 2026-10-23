-- Add decline tracking columns to mover_m365_actions
-- decline_reason: text reason entered by the approver when declining
-- declined_by: email of the person who declined
-- declined_at: timestamp of when the decline happened

ALTER TABLE mover_m365_actions
  ADD COLUMN IF NOT EXISTS decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS declined_by TEXT,
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

-- Add 'declined' to the persona_schedule_status CHECK constraint
-- Drop and re-create to include the new value
ALTER TABLE mover_m365_actions DROP CONSTRAINT IF EXISTS mover_m365_actions_persona_schedule_status_check;
ALTER TABLE mover_m365_actions
  ADD CONSTRAINT mover_m365_actions_persona_schedule_status_check
  CHECK (persona_schedule_status IN ('pending_approval','scheduled','running','blocked','completed','cancelled','declined','failed','missed'));

-- Rollback:
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS decline_reason;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS declined_by;
--   ALTER TABLE mover_m365_actions DROP COLUMN IF EXISTS declined_at;
--   ALTER TABLE mover_m365_actions DROP CONSTRAINT IF EXISTS mover_m365_actions_persona_schedule_status_check;
--   ALTER TABLE mover_m365_actions ADD CONSTRAINT mover_m365_actions_persona_schedule_status_check CHECK (persona_schedule_status IN ('pending_approval','scheduled','running','blocked','completed','cancelled','failed','missed'));
