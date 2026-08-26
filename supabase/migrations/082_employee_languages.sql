-- ============================================================================
-- 082 — Employee Languages table
-- Separate from skills — languages have their own proficiency scale.
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_languages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  language text NOT NULL,
  proficiency text NOT NULL CHECK (proficiency IN ('basic','conversational','professional','fluent','native')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, language)
);

ALTER TABLE employee_languages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company scoped read" ON employee_languages FOR SELECT
  USING (can_access_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON employee_languages FOR INSERT
  WITH CHECK (can_access_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON employee_languages FOR UPDATE
  USING (can_access_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON employee_languages FOR DELETE
  USING (can_access_company(company_id) OR is_super_admin());

CREATE INDEX idx_employee_languages_employee ON employee_languages(employee_id);
CREATE INDEX idx_employee_languages_company ON employee_languages(company_id);
