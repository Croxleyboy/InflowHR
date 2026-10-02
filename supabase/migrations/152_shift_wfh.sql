-- Add work_from_home flag to shift templates
ALTER TABLE shift_templates
  ADD COLUMN IF NOT EXISTS work_from_home BOOLEAN NOT NULL DEFAULT false;
