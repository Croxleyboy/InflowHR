-- Shift Skills: company-defined skills that can be required on shifts and assigned to employees

CREATE TABLE IF NOT EXISTS shift_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, name)
);

ALTER TABLE shift_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_skills_select" ON shift_skills FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "shift_skills_insert" ON shift_skills FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "shift_skills_update" ON shift_skills FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "shift_skills_delete" ON shift_skills FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

-- Junction: which skills a shift template requires
CREATE TABLE IF NOT EXISTS shift_template_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  shift_skill_id UUID NOT NULL REFERENCES shift_skills(id) ON DELETE CASCADE,
  UNIQUE(shift_template_id, shift_skill_id)
);

ALTER TABLE shift_template_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_template_skills_select" ON shift_template_skills FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "shift_template_skills_insert" ON shift_template_skills FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "shift_template_skills_update" ON shift_template_skills FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "shift_template_skills_delete" ON shift_template_skills FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

-- Junction: which skills an employee has
CREATE TABLE IF NOT EXISTS employee_shift_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_skill_id UUID NOT NULL REFERENCES shift_skills(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, shift_skill_id)
);

ALTER TABLE employee_shift_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_shift_skills_select" ON employee_shift_skills FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "employee_shift_skills_insert" ON employee_shift_skills FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "employee_shift_skills_update" ON employee_shift_skills FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "employee_shift_skills_delete" ON employee_shift_skills FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());
