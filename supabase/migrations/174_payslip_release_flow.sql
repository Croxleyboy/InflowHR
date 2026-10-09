-- Add released flag to payslips so finance can approve before employees see them
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS released BOOLEAN NOT NULL DEFAULT false;

-- Update payslips status constraint to include 'flagged' (already used in UI)
ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_status_check;
ALTER TABLE payslips ADD CONSTRAINT payslips_status_check
  CHECK (status IN ('draft', 'processed', 'paid', 'flagged'));

-- Add 'completed' to pay_runs status (wizard finished, awaiting finance release)
ALTER TABLE pay_runs DROP CONSTRAINT IF EXISTS pay_runs_status_check;
ALTER TABLE pay_runs ADD CONSTRAINT pay_runs_status_check
  CHECK (status IN ('draft', 'generating', 'exported', 'processing', 'synced', 'completed', 'released', 'cancelled'));

-- Mark all existing 'paid' payslips as released (they were already visible to employees)
UPDATE payslips SET released = true WHERE status = 'paid';

-- Index for employee-facing query filtering
CREATE INDEX IF NOT EXISTS idx_payslips_released ON payslips(released) WHERE released = true;
