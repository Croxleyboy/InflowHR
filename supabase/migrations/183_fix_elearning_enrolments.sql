-- Fix course_enrolments: currently course_id is BIGINT referencing courses(id),
-- but the app writes TEXT ids from elearning_courses. Recreate with correct types.

-- 1. Drop old table and recreate with correct FK
DROP TABLE IF EXISTS course_enrolments CASCADE;

CREATE TABLE course_enrolments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES elearning_courses(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  score INTEGER,
  UNIQUE (company_id, employee_id, course_id)
);

CREATE INDEX idx_course_enrolments_company ON course_enrolments(company_id);
CREATE INDEX idx_course_enrolments_employee ON course_enrolments(employee_id);

ALTER TABLE course_enrolments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ce_select" ON course_enrolments FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ce_insert" ON course_enrolments FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ce_update" ON course_enrolments FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ce_delete" ON course_enrolments FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

REVOKE ALL ON course_enrolments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON course_enrolments TO authenticated;

-- 2. Update delete_company_data to include new table
-- (CASCADE on company_id handles this automatically now)
