-- IFO-H01: Allow employee approvers to update approval fields on onboarding_m365_actions
-- The existing m365_update policy requires is_company_admin(), which blocks employee-role
-- managers from recording their approval decision via the Notifications page.

CREATE POLICY "m365_approver_update" ON onboarding_m365_actions
  FOR UPDATE USING (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = onboarding_m365_actions.onboarding_id
        AND wt.assigned_to = (SELECT email FROM auth.users WHERE id = auth.uid())
        AND wt.record_type = 'M365 Provisioning'
        AND wt.status = 'Pending'
    )
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM workflow_tracker wt
      WHERE wt.onboard_id = onboarding_m365_actions.onboarding_id
        AND wt.assigned_to = (SELECT email FROM auth.users WHERE id = auth.uid())
        AND wt.record_type = 'M365 Provisioning'
        AND wt.status = 'Pending'
    )
  );
