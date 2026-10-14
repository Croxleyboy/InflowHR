-- Add response columns and employee tracking to hr_tickets
ALTER TABLE hr_tickets
  ADD COLUMN IF NOT EXISTS admin_response TEXT,
  ADD COLUMN IF NOT EXISTS responded_by TEXT,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS employee_email TEXT;
