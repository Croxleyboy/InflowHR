-- Add leave_allowance column to employees table (default 15 days)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_allowance INTEGER DEFAULT 15;
