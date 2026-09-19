-- Migration 103: REVOKE remaining SECURITY DEFINER functions from anon
-- Date: 19-09-2026
-- Purpose: Defence-in-depth — ensure no SECURITY DEFINER function from
--          migrations 047-049 is callable by the anon role.
--          These functions have internal auth guards, but an outer REVOKE
--          prevents any accidental anon invocation at the database level.


-- ── From migration 047_gdpr_compliance.sql ─────────────────────────────

REVOKE EXECUTE ON FUNCTION public.has_active_support_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_active_support_access(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.log_gdpr_action(uuid, text, text, text, jsonb, jsonb, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_gdpr_action(uuid, text, text, text, jsonb, jsonb, uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.can_access_company(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_company(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.export_employee_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.export_employee_data(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.anonymise_employee(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.anonymise_employee(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.grant_support_access(uuid, uuid, text, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_support_access(uuid, uuid, text, text, int) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.revoke_support_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_support_access(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.expire_stale_support_grants() FROM anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_support_grants() TO authenticated;


-- ── From migration 049_refine_gdpr_access.sql ──────────────────────────

REVOKE EXECUTE ON FUNCTION public.get_all_company_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_all_company_metrics() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_company_metrics(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_company_metrics(uuid) TO authenticated;
