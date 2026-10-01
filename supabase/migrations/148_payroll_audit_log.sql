-- Migration 148: Payroll audit log
-- GDPR-compliant, company-scoped log of all payroll actions

CREATE TABLE IF NOT EXISTS payroll_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action          text NOT NULL,
  detail          text,
  employee_id     uuid REFERENCES employees(id) ON DELETE SET NULL,
  performed_by    uuid NOT NULL REFERENCES auth.users(id),
  performer_name  text,
  status          text NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'error', 'warning')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payroll_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pal_select" ON payroll_audit_log FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "pal_insert" ON payroll_audit_log FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "pal_delete" ON payroll_audit_log FOR DELETE
  USING (is_super_admin());

CREATE INDEX idx_pal_company ON payroll_audit_log(company_id);
CREATE INDEX idx_pal_employee ON payroll_audit_log(employee_id);
CREATE INDEX idx_pal_created ON payroll_audit_log(created_at DESC);
CREATE INDEX idx_pal_action ON payroll_audit_log(action);

COMMENT ON TABLE payroll_audit_log IS 'GDPR audit trail for all payroll actions — company-scoped, immutable by company admins';
