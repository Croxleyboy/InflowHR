-- Add SELF_GRANT_ACCESS to the allowed actions in gdpr_audit_logs
-- The ensure_super_admin_access RPC logs with this action but it was missing from the constraint
ALTER TABLE gdpr_audit_logs DROP CONSTRAINT IF EXISTS gdpr_audit_logs_action_check;
ALTER TABLE gdpr_audit_logs ADD CONSTRAINT gdpr_audit_logs_action_check
  CHECK (action IN (
    'SELECT', 'INSERT', 'UPDATE', 'DELETE',
    'EXPORT', 'ANONYMISE', 'GRANT_ACCESS', 'REVOKE_ACCESS',
    'SELF_GRANT_ACCESS'
  ));
