-- Add 'processing' and 'cancelled' to pay_runs status constraint
ALTER TABLE pay_runs DROP CONSTRAINT IF EXISTS pay_runs_status_check;
ALTER TABLE pay_runs ADD CONSTRAINT pay_runs_status_check
  CHECK (status IN ('draft', 'generating', 'exported', 'processing', 'synced', 'released', 'cancelled'));
