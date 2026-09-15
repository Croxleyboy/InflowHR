-- Expense cost centers (per company)
CREATE TABLE IF NOT EXISTS expense_cost_centers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE expense_cost_centers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_cost_centers_select" ON expense_cost_centers
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true)
    OR is_super_admin()
  );

CREATE POLICY "expense_cost_centers_insert" ON expense_cost_centers
  FOR INSERT WITH CHECK (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true AND role = 'admin')
    OR is_super_admin()
  );

CREATE POLICY "expense_cost_centers_delete" ON expense_cost_centers
  FOR DELETE USING (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true AND role = 'admin')
    OR is_super_admin()
  );

-- Expense types (per company)
CREATE TABLE IF NOT EXISTS expense_expense_types (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE expense_expense_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_expense_types_select" ON expense_expense_types
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true)
    OR is_super_admin()
  );

CREATE POLICY "expense_expense_types_insert" ON expense_expense_types
  FOR INSERT WITH CHECK (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true AND role = 'admin')
    OR is_super_admin()
  );

CREATE POLICY "expense_expense_types_delete" ON expense_expense_types
  FOR DELETE USING (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true AND role = 'admin')
    OR is_super_admin()
  );

-- Add these tables to delete_company_data and export_company_data
-- (They will cascade via ON DELETE CASCADE, but explicit cleanup is consistent)
