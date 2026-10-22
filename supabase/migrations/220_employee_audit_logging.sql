-- ============================================================
-- 220: Employee Audit Logging
--
-- Adds:
--   1. employee_audit_logging toggle on companies table
--   2. Super-admin-only RPC to clear employee audit logs
-- ============================================================

-- 1. Per-company toggle for employee audit logging
ALTER TABLE companies ADD COLUMN IF NOT EXISTS employee_audit_logging boolean NOT NULL DEFAULT true;

-- 2. Super-admin-only RPC to clear employee-specific audit logs by date range
-- The SECURITY DEFINER function runs as the function owner (superuser),
-- bypassing the REVOKE UPDATE/DELETE on gdpr_audit_logs and RLS policies.
-- Only super admins can call it (enforced inside the function body).
CREATE OR REPLACE FUNCTION clear_employee_audit_logs(
  p_before timestamptz,
  p_company_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can clear audit logs';
  END IF;

  IF p_company_id IS NOT NULL THEN
    DELETE FROM gdpr_audit_logs
    WHERE performed_at < p_before
      AND company_id = p_company_id
      AND table_name = 'employees'
      AND action = 'UPDATE';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    DELETE FROM gdpr_audit_logs
    WHERE performed_at < p_before
      AND table_name = 'employees'
      AND action = 'UPDATE';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN v_count;
END;
$$;
