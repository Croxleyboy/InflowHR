-- Add auto_approve flag to expense_claims and leave_requests
-- Values: 'yes' (auto-approve for all), 'only_managers' (managers auto-approved), 'no' (always requires approval)
-- Default: 'only_managers'

ALTER TABLE expense_claims
  ADD COLUMN IF NOT EXISTS auto_approve TEXT NOT NULL DEFAULT 'only_managers'
  CHECK (auto_approve IN ('yes', 'only_managers', 'no'));

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS auto_approve TEXT NOT NULL DEFAULT 'only_managers'
  CHECK (auto_approve IN ('yes', 'only_managers', 'no'));

-- Allow managers to delete submitted expense claims and leave requests
-- We add anon DELETE policies so that any authenticated/anon user acting as manager can delete

-- expense_claims: allow delete for anon (manager will be validated in app logic)
DROP POLICY IF EXISTS "anon_delete_expense_claims" ON expense_claims;
CREATE POLICY "anon_delete_expense_claims" ON expense_claims
  FOR DELETE TO anon USING (true);

-- expense_line_items: allow delete for anon
DROP POLICY IF EXISTS "anon_delete_expense_line_items" ON expense_line_items;
CREATE POLICY "anon_delete_expense_line_items" ON expense_line_items
  FOR DELETE TO anon USING (true);

-- leave_requests: allow delete for anon
DROP POLICY IF EXISTS "anon_delete_leave_requests" ON leave_requests;
CREATE POLICY "anon_delete_leave_requests" ON leave_requests
  FOR DELETE TO anon USING (true);

-- workflow_tracker: allow delete for anon (to clean up related workflow entries)
DROP POLICY IF EXISTS "anon_delete_workflow_tracker" ON workflow_tracker;
CREATE POLICY "anon_delete_workflow_tracker" ON workflow_tracker
  FOR DELETE TO anon USING (true);
