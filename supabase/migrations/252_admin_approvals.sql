-- Migration 252: Admin Approvals — 2-step approval workflow for destructive actions

-- Company settings for 2-step approvals
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS two_step_approvals_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_nominated_email TEXT DEFAULT NULL;

-- Admin approval requests table
CREATE TABLE IF NOT EXISTS admin_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'legal_timesheet', 'timesheet', 'shift_rota', 'access_request', 'payroll_month'
  )),
  action TEXT NOT NULL CHECK (action IN ('delete', 'revoke')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'restored')),
  record_id TEXT,
  record_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  requester_name TEXT,
  approved_by UUID REFERENCES auth.users(id),
  approver_name TEXT,
  approved_at TIMESTAMPTZ,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_approvals_company ON admin_approvals(company_id, status);
CREATE INDEX IF NOT EXISTS idx_admin_approvals_category ON admin_approvals(company_id, category);

ALTER TABLE admin_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_approvals_read" ON admin_approvals
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "admin_approvals_write" ON admin_approvals
  FOR ALL USING (company_id = get_my_company_id() OR is_super_admin());

-- Admin approval audit log
CREATE TABLE IF NOT EXISTS admin_approval_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  approval_id UUID NOT NULL REFERENCES admin_approvals(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT,
  performed_by UUID NOT NULL REFERENCES auth.users(id),
  performer_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_audit_approval ON admin_approval_audit(approval_id);

ALTER TABLE admin_approval_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approval_audit_read" ON admin_approval_audit
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "approval_audit_write" ON admin_approval_audit
  FOR ALL USING (company_id = get_my_company_id() OR is_super_admin());
