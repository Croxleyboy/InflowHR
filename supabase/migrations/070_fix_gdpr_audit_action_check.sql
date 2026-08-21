-- Add SELF_GRANT_ACCESS to the allowed actions in gdpr_audit_logs
-- The ensure_super_admin_access RPC logs with this action but it was missing from the constraint
ALTER TABLE gdpr_audit_logs DROP CONSTRAINT IF EXISTS gdpr_audit_logs_action_check;
ALTER TABLE gdpr_audit_logs ADD CONSTRAINT gdpr_audit_logs_action_check
  CHECK (action IN (
    'SELECT', 'INSERT', 'UPDATE', 'DELETE',
    'EXPORT', 'ANONYMISE', 'GRANT_ACCESS', 'REVOKE_ACCESS',
    'SELF_GRANT_ACCESS'
  ));

-- Grant support access for a single company (used on company creation)
CREATE OR REPLACE FUNCTION grant_support_access_for_company(
  p_company_id uuid,
  p_hours int DEFAULT 48
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sa_uid uuid;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can call this function';
  END IF;

  v_sa_uid := auth.uid();

  INSERT INTO tenant_support_access (
    company_id, granted_by, granted_to, reason, scope, expires_at
  ) VALUES (
    p_company_id,
    v_sa_uid,
    v_sa_uid,
    'Auto-granted on company creation',
    'full',
    now() + (p_hours || ' hours')::interval
  );
END;
$$;

GRANT EXECUTE ON FUNCTION grant_support_access_for_company(uuid, int) TO authenticated;
