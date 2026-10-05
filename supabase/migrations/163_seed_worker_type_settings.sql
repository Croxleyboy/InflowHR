-- Seed worker_type_settings for existing trial/demo companies that don't have them yet.
-- Also adds worker_type_settings creation to the run_demo_seed function.

-- 1. Backfill: insert defaults for any company missing worker_type_settings rows
INSERT INTO worker_type_settings (company_id, worker_type, pay_pattern, overtime_handling, time_recording, overtime_rate_multiplier)
SELECT c.id, 'employed', 'monthly', 'none', 'timesheet', 1.50
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM worker_type_settings wts WHERE wts.company_id = c.id AND wts.worker_type = 'employed'
);

INSERT INTO worker_type_settings (company_id, worker_type, pay_pattern, overtime_handling, time_recording, overtime_rate_multiplier)
SELECT c.id, 'shift_worker', 'weekly', 'overtime', 'checkin', 1.50
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM worker_type_settings wts WHERE wts.company_id = c.id AND wts.worker_type = 'shift_worker'
);

INSERT INTO worker_type_settings (company_id, worker_type, pay_pattern, overtime_handling, time_recording, overtime_rate_multiplier)
SELECT c.id, 'zero_hours', 'weekly', 'none', 'checkin', 1.50
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM worker_type_settings wts WHERE wts.company_id = c.id AND wts.worker_type = 'zero_hours'
);

-- 2. Add employment_category column to onboarding table so it carries through from New Starter form
ALTER TABLE onboarding
  ADD COLUMN IF NOT EXISTS employment_category TEXT DEFAULT 'employed';
