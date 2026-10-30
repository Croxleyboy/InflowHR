-- Migration 251: Workflow step detail enhancements
-- Per-step checklists, activity log, step assignments, and due dates

-- Step checklist items (sub-tasks within a workflow step)
CREATE TABLE IF NOT EXISTS onboard_step_checklist (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_step_checklist_company
  ON onboard_step_checklist(company_id, step_key);

ALTER TABLE onboard_step_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "step_checklist_read" ON onboard_step_checklist
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "step_checklist_write" ON onboard_step_checklist
  FOR ALL USING (company_id = get_my_company_id() OR is_super_admin());

-- Per-onboarding checklist completion tracking
ALTER TABLE onboarding
  ADD COLUMN IF NOT EXISTS step_checklist_completed JSONB DEFAULT '{}'::jsonb;

-- Per-onboarding step assignments and due dates
ALTER TABLE onboarding
  ADD COLUMN IF NOT EXISTS step_assignments JSONB DEFAULT '{}'::jsonb;

-- Workflow activity log (per-onboarding step actions)
CREATE TABLE IF NOT EXISTS onboard_activity_log (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  onboarding_id INT NOT NULL,
  step_key TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_name TEXT,
  actor_email TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_onboarding
  ON onboard_activity_log(onboarding_id, step_key);

ALTER TABLE onboard_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_read" ON onboard_activity_log
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "activity_log_write" ON onboard_activity_log
  FOR ALL USING (company_id = get_my_company_id() OR is_super_admin());

-- Add assigned_to and due_offset_days to step definition (template-level defaults)
ALTER TABLE onboard_workflow_steps
  ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT 'manager',
  ADD COLUMN IF NOT EXISTS due_offset_days INT DEFAULT NULL;
