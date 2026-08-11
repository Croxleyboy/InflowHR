-- Add days_to_complete to elearning_courses (replaces fixed deadline date)
ALTER TABLE elearning_courses ADD COLUMN IF NOT EXISTS days_to_complete INTEGER;

-- Add enrolled_at to course_enrolments so we know when each employee was enrolled
ALTER TABLE course_enrolments ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ DEFAULT now();

-- Backfill enrolled_at from created_at for any existing enrolments that have it
-- (course_enrolments doesn't have created_at, use started_at as fallback)
UPDATE course_enrolments SET enrolled_at = COALESCE(started_at, now()) WHERE enrolled_at IS NULL;

-- Migrate existing deadline dates to days_to_complete (days from today)
-- Only for courses that have a future deadline set
UPDATE elearning_courses
SET days_to_complete = GREATEST(1, EXTRACT(DAY FROM (deadline::timestamp - now()))::int)
WHERE deadline IS NOT NULL AND deadline >= CURRENT_DATE;

-- Set a sensible default for required courses without a deadline
UPDATE elearning_courses
SET days_to_complete = 30
WHERE required = true AND days_to_complete IS NULL;
