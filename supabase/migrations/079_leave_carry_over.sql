-- Add max carry-over days setting per leave type per company
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS max_carry_over_days integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN leave_types.max_carry_over_days IS 'Maximum number of unused leave days that can be carried over to the next financial year. 0 means no carry-over allowed.';
