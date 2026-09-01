-- ============================================================
-- Fix hours column: convert from generated (single-day only)
-- to regular column that accounts for multi-day date ranges
-- ============================================================

-- Drop the generated column
ALTER TABLE timesheets DROP COLUMN hours;

-- Re-add as a regular numeric column
ALTER TABLE timesheets ADD COLUMN hours numeric(7,2);

-- Backfill: for single-day entries, hours = end_time - start_time
-- For multi-day entries, hours = daily_hours × working_days
UPDATE timesheets SET hours = CASE
  WHEN end_date IS NULL OR end_date = date THEN
    EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0
  ELSE
    (EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0) *
    (SELECT COUNT(*)::numeric FROM generate_series(date, end_date, '1 day'::interval) d
     WHERE EXTRACT(DOW FROM d) NOT IN (0, 6))
  END;

-- Make NOT NULL now that all rows are backfilled
ALTER TABLE timesheets ALTER COLUMN hours SET NOT NULL;
ALTER TABLE timesheets ALTER COLUMN hours SET DEFAULT 0;
