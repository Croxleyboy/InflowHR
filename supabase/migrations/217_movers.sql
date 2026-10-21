-- 217: Persona-Driven Movers — role change tracking + M365 mover integration
-- Adds persona tiers to employees, role_changes workflow table,
-- mover_m365_actions for engine integration, persona mappings for M365 config

BEGIN;

-- ============================================================
-- 1. Persona column on employees
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS persona text NOT NULL DEFAULT 'standard'
    CHECK (persona IN ('standard','mobile','strict_secure','kiosk'));

-- ============================================================
-- 2. Role changes table — tracks every mover event
-- ============================================================
CREATE TABLE IF NOT EXISTS role_changes (
  id                serial PRIMARY KEY,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_name     text NOT NULL,
  employee_email    text NOT NULL,

  change_type       text NOT NULL CHECK (change_type IN (
    'role_change','department_change','manager_change','location_change',
    'name_change','persona_change','multi_change'
  )),
  changes           jsonb NOT NULL DEFAULT '{}',

  effective_date    date,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','in_progress','completed','cancelled'
  )),

  workflow_steps    jsonb NOT NULL DEFAULT '{}',
  skipped_steps     jsonb NOT NULL DEFAULT '{}',
  is_complete       boolean NOT NULL DEFAULT false,

  requested_by      uuid REFERENCES auth.users(id),
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);

ALTER TABLE role_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_changes_select" ON role_changes
  FOR SELECT USING (
    company_id = get_my_company_id() OR is_super_admin()
  );

CREATE POLICY "role_changes_insert" ON role_changes
  FOR INSERT WITH CHECK (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "role_changes_update" ON role_changes
  FOR UPDATE USING (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "role_changes_delete" ON role_changes
  FOR DELETE USING (is_super_admin());

-- ============================================================
-- 3. Mover M365 actions table — mirrors joiner/leaver pattern
-- ============================================================
CREATE TABLE IF NOT EXISTS mover_m365_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_change_id        integer NOT NULL REFERENCES role_changes(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Run tracking (m365.mover "now")
  run_id                text,
  run_status            text CHECK (run_status IN (
    'checking_account','account_blocked','licence_unavailable',
    'ready_for_approval','awaiting_approval','updating','completed','failed'
  )),
  run_error             jsonb,
  run_result            jsonb,

  -- Approval tracking
  approval_sent_at      timestamptz,
  approval_status       text CHECK (approval_status IN ('pending','approved','declined')),
  approved_by           text,
  approved_at           timestamptz,

  -- Schedule tracking (hr.mover — future)
  schedule_id           text,
  schedule_status       text CHECK (schedule_status IS NULL OR schedule_status IN (
    'pending_approval','scheduled','running','blocked','completed','cancelled','failed','missed'
  )),
  schedule_message      text,
  schedule_stages       jsonb,
  schedule_next_due_at  timestamptz,
  schedule_updated_at   timestamptz,
  schedule_options      jsonb,

  -- Tracking
  employee_upn          text,
  attempt_count_run     integer NOT NULL DEFAULT 0,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (role_change_id)
);

ALTER TABLE mover_m365_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mover_m365_select" ON mover_m365_actions
  FOR SELECT USING (
    company_id = get_my_company_id() OR is_super_admin()
  );

CREATE POLICY "mover_m365_insert" ON mover_m365_actions
  FOR INSERT WITH CHECK (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "mover_m365_update" ON mover_m365_actions
  FOR UPDATE USING (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "mover_m365_delete" ON mover_m365_actions
  FOR DELETE USING (is_super_admin());

-- Approver update policy (uses auth.jwt() ->> 'email' per 216 fix)
CREATE POLICY "mover_m365_approver_update" ON mover_m365_actions
  FOR UPDATE USING (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = mover_m365_actions.role_change_id
        AND wt.assigned_to = (auth.jwt() ->> 'email')
        AND wt.record_type = 'M365 Mover'
        AND wt.status = 'Pending'
    )
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = mover_m365_actions.role_change_id
        AND wt.assigned_to = (auth.jwt() ->> 'email')
        AND wt.record_type = 'M365 Mover'
        AND wt.status = 'Pending'
    )
  );

-- ============================================================
-- 4. Persona mapping table — maps persona tier to M365 config
-- ============================================================
CREATE TABLE IF NOT EXISTS inflowonboarder_persona_mappings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  persona                   text NOT NULL CHECK (persona IN ('standard','mobile','strict_secure','kiosk')),

  extension_attribute_value text NOT NULL,
  m365_licence_sku_id       text,
  m365_licence_sku_name     text,
  m365_groups               text[] DEFAULT '{}',

  description               text,
  intune_profile_hint       text,
  conditional_access_hint   text,

  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, persona)
);

ALTER TABLE inflowonboarder_persona_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "persona_mappings_select" ON inflowonboarder_persona_mappings
  FOR SELECT USING (
    company_id = get_my_company_id() OR is_super_admin()
  );

CREATE POLICY "persona_mappings_insert" ON inflowonboarder_persona_mappings
  FOR INSERT WITH CHECK (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "persona_mappings_update" ON inflowonboarder_persona_mappings
  FOR UPDATE USING (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "persona_mappings_delete" ON inflowonboarder_persona_mappings
  FOR DELETE USING (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

-- ============================================================
-- 5. Mover approver settings on inflowonboarder_integrations
-- ============================================================
ALTER TABLE inflowonboarder_integrations
  ADD COLUMN IF NOT EXISTS mover_approver_mode text DEFAULT 'same_as_joiner'
    CHECK (mover_approver_mode IN ('same_as_joiner','nominated','manager')),
  ADD COLUMN IF NOT EXISTS mover_approver_name text,
  ADD COLUMN IF NOT EXISTS mover_approver_email text;

COMMIT;

-- ============================================================
-- Backout SQL (run to fully revert):
--   ALTER TABLE employees DROP COLUMN IF EXISTS persona;
--   DROP TABLE IF EXISTS mover_m365_actions;
--   DROP TABLE IF EXISTS role_changes;
--   DROP TABLE IF EXISTS inflowonboarder_persona_mappings;
--   ALTER TABLE inflowonboarder_integrations
--     DROP COLUMN IF EXISTS mover_approver_mode,
--     DROP COLUMN IF EXISTS mover_approver_name,
--     DROP COLUMN IF EXISTS mover_approver_email;
-- ============================================================
