-- InflowOnboarder leaver: M365 offboarding automation
-- Mirrors the joiner pattern (onboarding_m365_actions) for offboarding records

BEGIN;

-- ============================================================
-- 1. Offboarding M365 actions table (per-offboarding record)
-- ============================================================
CREATE TABLE IF NOT EXISTS offboarding_m365_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offboarding_id        integer NOT NULL REFERENCES offboarding(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Run tracking (same lifecycle as joiner)
  run_id                text,
  run_status            text CHECK (run_status IN (
    'checking_account', 'account_blocked', 'ready_for_approval',
    'deprovisioning', 'completed', 'failed'
  )),
  run_error             jsonb,
  run_result            jsonb,

  -- Approval tracking
  approval_sent_at      timestamptz,
  approval_status       text CHECK (approval_status IN ('pending', 'approved', 'declined')),
  approved_by           text,
  approved_at           timestamptz,

  -- Metadata
  employee_upn          text,
  attempt_count_run     integer NOT NULL DEFAULT 0,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (offboarding_id)
);

ALTER TABLE offboarding_m365_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offboard_m365_select" ON offboarding_m365_actions
  FOR SELECT USING (
    company_id = get_my_company_id() OR is_super_admin()
  );

CREATE POLICY "offboard_m365_insert" ON offboarding_m365_actions
  FOR INSERT WITH CHECK (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "offboard_m365_update" ON offboarding_m365_actions
  FOR UPDATE USING (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "offboard_m365_delete" ON offboarding_m365_actions
  FOR DELETE USING (is_super_admin());

-- Approver update policy: employee approvers can update approval fields
-- (mirrors m365_approver_update on onboarding_m365_actions from migration 203)
CREATE POLICY "offboard_m365_approver_update" ON offboarding_m365_actions
  FOR UPDATE USING (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = offboarding_m365_actions.offboarding_id
        AND wt.assigned_to = (SELECT email FROM auth.users WHERE id = auth.uid())
        AND wt.record_type = 'M365 Offboarding'
        AND wt.status = 'Pending'
    )
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = offboarding_m365_actions.offboarding_id
        AND wt.assigned_to = (SELECT email FROM auth.users WHERE id = auth.uid())
        AND wt.record_type = 'M365 Offboarding'
        AND wt.status = 'Pending'
    )
  );

-- ============================================================
-- 2. Offboard approver settings on inflowonboarder_integrations
-- ============================================================
ALTER TABLE inflowonboarder_integrations
  ADD COLUMN IF NOT EXISTS offboard_approver_mode text DEFAULT 'same_as_joiner'
    CHECK (offboard_approver_mode IN ('same_as_joiner', 'nominated', 'manager')),
  ADD COLUMN IF NOT EXISTS offboard_approver_name text,
  ADD COLUMN IF NOT EXISTS offboard_approver_email text;

COMMIT;

-- ============================================================
-- Backout SQL (run to fully revert):
--   DROP TABLE IF EXISTS offboarding_m365_actions;
--   ALTER TABLE inflowonboarder_integrations
--     DROP COLUMN IF EXISTS offboard_approver_mode,
--     DROP COLUMN IF EXISTS offboard_approver_name,
--     DROP COLUMN IF EXISTS offboard_approver_email;
-- ============================================================
