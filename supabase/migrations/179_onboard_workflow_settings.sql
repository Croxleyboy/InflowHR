-- Custom onboarding workflow steps (per-company)
CREATE TABLE IF NOT EXISTS onboard_workflow_steps (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📋',
  description TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_onboard_step_company_key
  ON onboard_workflow_steps(company_id, step_key);

ALTER TABLE onboard_workflow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboard_workflow_steps_read" ON onboard_workflow_steps
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "onboard_workflow_steps_write" ON onboard_workflow_steps
  FOR ALL USING (company_id = get_my_company_id() OR is_super_admin());

-- Track completion of custom steps on each onboarding record
ALTER TABLE onboarding
  ADD COLUMN IF NOT EXISTS custom_steps_completed JSONB DEFAULT '{}'::jsonb;

-- Offboarding custom steps (per-company)
CREATE TABLE IF NOT EXISTS offboard_workflow_steps (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📋',
  description TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  role TEXT DEFAULT 'HR',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_offboard_step_company_key
  ON offboard_workflow_steps(company_id, step_key);

ALTER TABLE offboard_workflow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offboard_workflow_steps_read" ON offboard_workflow_steps
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "offboard_workflow_steps_write" ON offboard_workflow_steps
  FOR ALL USING (company_id = get_my_company_id() OR is_super_admin());
