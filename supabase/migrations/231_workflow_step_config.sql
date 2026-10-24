-- Workflow step notification/meeting config (per-step JSONB)
ALTER TABLE onboard_workflow_steps
  ADD COLUMN IF NOT EXISTS step_config JSONB DEFAULT '{}'::jsonb;

ALTER TABLE offboard_workflow_steps
  ADD COLUMN IF NOT EXISTS step_config JSONB DEFAULT '{}'::jsonb;

-- Company contact points (IT Admin, Support, Facilities etc.)
CREATE TABLE IF NOT EXISTS company_contacts (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_key TEXT NOT NULL,
  label TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_contacts_key
  ON company_contacts(company_id, contact_key);

ALTER TABLE company_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_contacts_read" ON company_contacts
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "company_contacts_write" ON company_contacts
  FOR ALL USING (company_id = get_my_company_id() OR is_super_admin());

-- Seed default contact types for existing companies with custom steps
INSERT INTO company_contacts (company_id, contact_key, label, sort_order)
SELECT DISTINCT c.id, k.contact_key, k.label, k.sort_order
FROM companies c
CROSS JOIN (VALUES
  ('it_admin', 'IT Admin', 0),
  ('support', 'Support', 1),
  ('facilities', 'Facilities', 2),
  ('security', 'Security', 3)
) AS k(contact_key, label, sort_order)
WHERE EXISTS (SELECT 1 FROM onboard_workflow_steps ows WHERE ows.company_id = c.id)
   OR EXISTS (SELECT 1 FROM offboard_workflow_steps ofs WHERE ofs.company_id = c.id)
ON CONFLICT DO NOTHING;
