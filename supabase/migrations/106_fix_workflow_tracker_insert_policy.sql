-- Migration 106: Fix workflow_tracker INSERT policy
-- Migration 097 restricted INSERT to company admins only, but employees
-- need to insert workflow_tracker rows when submitting leave requests,
-- expenses, etc. Restore the original company-scoped policy.

DROP POLICY IF EXISTS "workflow_tracker_admin_insert" ON workflow_tracker;

CREATE POLICY "workflow_tracker_company_insert" ON workflow_tracker FOR INSERT
  TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
