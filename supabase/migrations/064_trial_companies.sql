-- Add trial support columns to companies table
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_start_date DATE,
  ADD COLUMN IF NOT EXISTS trial_end_date DATE;

-- Validate trial dates: end must be after start
ALTER TABLE companies
  ADD CONSTRAINT trial_dates_check
  CHECK (
    (is_trial = false)
    OR (trial_start_date IS NOT NULL AND trial_end_date IS NOT NULL AND trial_end_date > trial_start_date)
  );
