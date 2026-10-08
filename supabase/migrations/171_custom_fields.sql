-- Company-defined custom employee profile fields (up to 5 per company).
-- Admins configure title, type, default value, and visibility per field.
-- Values are stored per employee in a separate table.

CREATE TABLE IF NOT EXISTS company_custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  field_number SMALLINT NOT NULL CHECK (field_number BETWEEN 1 AND 5),
  title TEXT NOT NULL DEFAULT '',
  field_type TEXT NOT NULL DEFAULT 'short' CHECK (field_type IN ('short', 'long')),
  default_value TEXT NOT NULL DEFAULT '',
  is_visible BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, field_number)
);

CREATE TABLE IF NOT EXISTS employee_custom_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  field_number SMALLINT NOT NULL CHECK (field_number BETWEEN 1 AND 5),
  value TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, field_number)
);

ALTER TABLE company_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_custom_field_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ccf_select" ON company_custom_fields FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ccf_insert" ON company_custom_fields FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ccf_update" ON company_custom_fields FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ccf_delete" ON company_custom_fields FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "ecfv_select" ON employee_custom_field_values FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ecfv_insert" ON employee_custom_field_values FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ecfv_update" ON employee_custom_field_values FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ecfv_delete" ON employee_custom_field_values FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE INDEX idx_ccf_company ON company_custom_fields(company_id);
CREATE INDEX idx_ecfv_employee ON employee_custom_field_values(employee_id);
CREATE INDEX idx_ecfv_company ON employee_custom_field_values(company_id);
