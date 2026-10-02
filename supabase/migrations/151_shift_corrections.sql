-- Shift corrections: tracks time discrepancies and employee/admin resolution workflow
CREATE TABLE IF NOT EXISTS shift_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_assignment_id uuid NOT NULL,
  checkin_record_id uuid REFERENCES checkin_records(id) ON DELETE SET NULL,
  correction_type text NOT NULL CHECK (correction_type IN ('late_checkin', 'early_checkout', 'no_checkin', 'no_checkout')),
  shift_date date NOT NULL,
  expected_time text,
  actual_time text,
  variance_minutes integer NOT NULL DEFAULT 0,
  employee_comment text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'approved', 'declined')),
  admin_comment text,
  resolved_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, shift_assignment_id, correction_type)
);

ALTER TABLE shift_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_corrections_read"
  ON shift_corrections FOR SELECT
  USING (
    company_id = get_my_company_id()
    OR company_id IN (SELECT e.company_id FROM employees e JOIN company_users cu ON cu.employee_id = e.id WHERE cu.auth_user_id = auth.uid())
    OR is_super_admin()
  );

CREATE POLICY "shift_corrections_insert"
  ON shift_corrections FOR INSERT
  WITH CHECK (
    (company_id = get_my_company_id()
     OR company_id IN (SELECT e.company_id FROM employees e JOIN company_users cu ON cu.employee_id = e.id WHERE cu.auth_user_id = auth.uid()))
    AND employee_id IN (SELECT cu.employee_id FROM company_users cu WHERE cu.auth_user_id = auth.uid() AND cu.employee_id IS NOT NULL)
  );

CREATE POLICY "shift_corrections_update"
  ON shift_corrections FOR UPDATE
  USING (
    company_id = get_my_company_id()
    OR company_id IN (SELECT e.company_id FROM employees e JOIN company_users cu ON cu.employee_id = e.id WHERE cu.auth_user_id = auth.uid())
    OR is_super_admin()
  );

CREATE POLICY "shift_corrections_delete"
  ON shift_corrections FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

REVOKE ALL ON shift_corrections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON shift_corrections TO authenticated;

CREATE INDEX idx_shift_corrections_company ON shift_corrections(company_id);
CREATE INDEX idx_shift_corrections_employee ON shift_corrections(employee_id);
CREATE INDEX idx_shift_corrections_status ON shift_corrections(company_id, status);
CREATE INDEX idx_shift_corrections_assignment ON shift_corrections(shift_assignment_id);
