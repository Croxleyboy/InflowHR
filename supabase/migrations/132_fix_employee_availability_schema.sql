-- Migration 132: Standardise employee_availability table schema
-- The table was created in the Supabase dashboard with unknown column names.
-- Our code expects: employee_id, company_id, day_of_week, is_available, start_time, end_time
-- This migration ensures those columns exist.

-- Add start_time if missing (ignore error if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_availability'
      AND column_name = 'start_time'
  ) THEN
    -- Check if available_from exists and rename it
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employee_availability'
        AND column_name = 'available_from'
    ) THEN
      ALTER TABLE employee_availability RENAME COLUMN available_from TO start_time;
    ELSE
      ALTER TABLE employee_availability ADD COLUMN start_time TIME NOT NULL DEFAULT '09:00';
    END IF;
  END IF;
END $$;

-- Add end_time if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_availability'
      AND column_name = 'end_time'
  ) THEN
    -- Check if available_to exists and rename it
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employee_availability'
        AND column_name = 'available_to'
    ) THEN
      ALTER TABLE employee_availability RENAME COLUMN available_to TO end_time;
    ELSE
      ALTER TABLE employee_availability ADD COLUMN end_time TIME NOT NULL DEFAULT '17:00';
    END IF;
  END IF;
END $$;

-- Drop recurring column if it exists (not used)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_availability'
      AND column_name = 'recurring'
  ) THEN
    ALTER TABLE employee_availability DROP COLUMN recurring;
  END IF;
END $$;

-- Ensure RLS is enabled
ALTER TABLE employee_availability ENABLE ROW LEVEL SECURITY;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
