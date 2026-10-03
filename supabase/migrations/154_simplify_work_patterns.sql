-- Migration 154: Simplify work patterns
-- Consolidate work_patterns table + working_pattern column into a single
-- contracted_days boolean[7] column on employees.
-- All logic now driven by employment_category + contract_type + contracted_days.

-- Step 1: Add contracted_days column with Mon-Fri default
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS contracted_days boolean[7]
  DEFAULT '{true,true,true,true,true,false,false}';

-- Step 2: Migrate existing work_patterns data into employees
-- Copy the days array from linked work_patterns; variable patterns get NULL (any day)
UPDATE employees e
SET contracted_days = CASE
  WHEN wp.pattern_type = 'variable' THEN NULL
  ELSE wp.days
END
FROM work_patterns wp
WHERE e.work_pattern_id = wp.id;

-- Employees with no work_pattern_id who are shift workers get NULL (any day)
UPDATE employees
SET contracted_days = NULL
WHERE employment_category = 'shift_worker'
  AND work_pattern_id IS NULL;

-- Step 3: Drop the FK constraints and columns referencing work_patterns
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_work_pattern_id_fkey;
ALTER TABLE employees DROP COLUMN IF EXISTS work_pattern_id;

ALTER TABLE onboarding DROP CONSTRAINT IF EXISTS onboarding_work_pattern_id_fkey;
ALTER TABLE onboarding DROP COLUMN IF EXISTS work_pattern_id;

-- Step 4: Drop the legacy working_pattern column
ALTER TABLE employees DROP COLUMN IF EXISTS working_pattern;

-- Step 5: Drop the work_patterns table
DROP TABLE IF EXISTS work_patterns;
