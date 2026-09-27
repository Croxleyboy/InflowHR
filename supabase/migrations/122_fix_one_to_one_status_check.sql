-- PF-01: Add 'not_confirmed' to allowed statuses on one_to_one_meetings.
-- The auto-cleanup in OneToOnes.tsx sets past pending meetings to 'not_confirmed'
-- but the CHECK constraint only allowed pending/accepted/declined/completed/cancelled.

ALTER TABLE one_to_one_meetings DROP CONSTRAINT IF EXISTS one_to_one_meetings_status_check;

ALTER TABLE one_to_one_meetings ADD CONSTRAINT one_to_one_meetings_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled', 'not_confirmed'));
