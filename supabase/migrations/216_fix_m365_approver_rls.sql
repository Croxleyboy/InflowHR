-- Fix "permission denied for table users" in m365 approver RLS policies.
-- Replace direct auth.users subquery with auth.jwt() ->> 'email' which
-- reads from the JWT token without requiring SELECT on auth.users.

-- 1. Joiner: onboarding_m365_actions
DROP POLICY IF EXISTS "m365_approver_update" ON onboarding_m365_actions;

CREATE POLICY "m365_approver_update" ON onboarding_m365_actions
  FOR UPDATE USING (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = onboarding_m365_actions.onboarding_id
        AND wt.assigned_to = (auth.jwt() ->> 'email')
        AND wt.record_type = 'M365 Provisioning'
        AND wt.status = 'Pending'
    )
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = onboarding_m365_actions.onboarding_id
        AND wt.assigned_to = (auth.jwt() ->> 'email')
        AND wt.record_type = 'M365 Provisioning'
        AND wt.status = 'Pending'
    )
  );

-- 2. Leaver: offboarding_m365_actions
DROP POLICY IF EXISTS "offboard_m365_approver_update" ON offboarding_m365_actions;

CREATE POLICY "offboard_m365_approver_update" ON offboarding_m365_actions
  FOR UPDATE USING (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = offboarding_m365_actions.offboarding_id
        AND wt.assigned_to = (auth.jwt() ->> 'email')
        AND wt.record_type = 'M365 Offboarding'
        AND wt.status = 'Pending'
    )
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = offboarding_m365_actions.offboarding_id
        AND wt.assigned_to = (auth.jwt() ->> 'email')
        AND wt.record_type = 'M365 Offboarding'
        AND wt.status = 'Pending'
    )
  );
