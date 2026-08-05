-- Add end_date column to timesheets (date column serves as start_date)
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS end_date date;

-- Backfill: existing rows get end_date = date (single-day entries)
UPDATE timesheets SET end_date = date WHERE end_date IS NULL;

-- Make end_date NOT NULL going forward
ALTER TABLE timesheets ALTER COLUMN end_date SET NOT NULL;
ALTER TABLE timesheets ALTER COLUMN end_date SET DEFAULT CURRENT_DATE;

-- Add constraint: end_date >= date (start)
ALTER TABLE timesheets ADD CONSTRAINT timesheets_date_range_check CHECK (end_date >= date);
