-- Add break_minutes to shift_templates (default 30 minutes).
-- Recorded Time and payroll deduct this from recorded hours to get payable hours.

ALTER TABLE shift_templates
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 30;
