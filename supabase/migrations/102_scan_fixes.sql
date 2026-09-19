-- SG-01: Rewrite get_super_admin_uid() to query super_admins table
-- instead of hardcoding andy.jones@kumonix.com
--
-- SG-02: REVOKE EXECUTE FROM anon on all SECURITY DEFINER functions
-- (defence-in-depth — anon role should never call these)
--
-- SG-03: Drop the overly-permissive app_settings SELECT policy
-- that allowed any authenticated user to read all rows (USING(true))


-- ── SG-01: get_super_admin_uid() ────────────────────────────────────────
-- Previously hardcoded: SELECT id FROM auth.users WHERE email = 'andy.jones@kumonix.com'
-- Now queries the super_admins table (created in migration 093)
CREATE OR REPLACE FUNCTION get_super_admin_uid()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT au.id INTO v_uid
    FROM auth.users au
    INNER JOIN super_admins sa ON au.email = sa.email
    LIMIT 1;
  RETURN v_uid;
END;
$$;


-- ── SG-02: REVOKE FROM anon on SECURITY DEFINER functions ───────────────
REVOKE EXECUTE ON FUNCTION public.get_super_admin_uid()                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_super_admin_access(int)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.extend_support_access(uuid, int)         FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_current_month_checkins(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_company_user()                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_nonsso_account(text, text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.setup_nonsso_admin(uuid, text, uuid, text)    FROM anon;

GRANT EXECUTE ON FUNCTION public.get_super_admin_uid()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_super_admin_access(int)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.extend_support_access(uuid, int)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_current_month_checkins(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_company_user()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_nonsso_account(text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.setup_nonsso_admin(uuid, text, uuid, text)    TO authenticated;


-- ── SG-03: Drop overly-permissive app_settings SELECT policy ────────────
-- Migration 093 added USING(true) which overrides the company-scoped
-- policy from migration 032. With the client fix in LanguageContext.tsx
-- (.limit(1) instead of .eq('id', 1)), this is now safe to remove.
DROP POLICY IF EXISTS "Authenticated users can read app_settings" ON app_settings;
