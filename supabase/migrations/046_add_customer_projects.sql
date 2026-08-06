CREATE TABLE IF NOT EXISTS customer_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE customer_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_projects_company" ON customer_projects
  FOR ALL USING (company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true));

ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES customer_projects(id);
