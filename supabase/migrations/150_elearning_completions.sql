-- Create the elearning_completions table (was referenced in code but never created)
CREATE TABLE IF NOT EXISTS elearning_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES elearning_courses(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, course_id)
);

ALTER TABLE elearning_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "elearning_completions_read"
  ON elearning_completions FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "elearning_completions_insert"
  ON elearning_completions FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "elearning_completions_delete"
  ON elearning_completions FOR DELETE
  USING (company_id = get_my_company_id());

REVOKE ALL ON elearning_completions FROM anon;
GRANT SELECT, INSERT, DELETE ON elearning_completions TO authenticated;
