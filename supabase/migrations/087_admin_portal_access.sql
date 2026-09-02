-- Role permission templates per company
CREATE TABLE admin_portal_roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  role_label TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, role_key)
);

ALTER TABLE admin_portal_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read admin_portal_roles" ON admin_portal_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert admin_portal_roles" ON admin_portal_roles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update admin_portal_roles" ON admin_portal_roles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete admin_portal_roles" ON admin_portal_roles FOR DELETE TO authenticated USING (true);

-- Employee access assignments
CREATE TABLE admin_portal_access (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  granted_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, employee_id)
);

ALTER TABLE admin_portal_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read admin_portal_access" ON admin_portal_access FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert admin_portal_access" ON admin_portal_access FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update admin_portal_access" ON admin_portal_access FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete admin_portal_access" ON admin_portal_access FOR DELETE TO authenticated USING (true);
