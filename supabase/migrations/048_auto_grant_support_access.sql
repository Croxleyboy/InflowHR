-- ============================================================
-- 048: Auto-grant super admin support access + helper functions
--
-- 1. get_super_admin_uid() — looks up the super admin's auth user
-- 2. Auto-grant 48hr full access for all existing companies
-- 3. ensure_super_admin_access() — callable from UI to refresh grants
-- 4. extend_support_access() — extend an existing grant
-- ============================================================

-- Helper to look up super admin auth.uid() by email
CREATE OR REPLACE FUNCTION get_super_admin_uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users WHERE email = 'andy.jones@kumonix.com' LIMIT 1;
$$;

-- Auto-grant 48hr access for all companies that don't have an active grant
DO $$
DECLARE
  v_sa_uid uuid;
BEGIN
  SELECT get_super_admin_uid() INTO v_sa_uid;
  IF v_sa_uid IS NULL THEN
    RAISE NOTICE 'Super admin user not found — skipping auto-grant';
    RETURN;
  END IF;

  INSERT INTO tenant_support_access (
    company_id, granted_by, granted_to, reason, scope, expires_at
  )
  SELECT
    c.id,
    v_sa_uid,
    v_sa_uid,
    'Initial platform setup — auto-granted',
    'full',
    now() + interval '48 hours'
  FROM companies c
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant_support_access t
    WHERE t.company_id = c.id
      AND t.granted_to = v_sa_uid
      AND t.status = 'active'
      AND t.expires_at > now()
  );
END $$;

-- RPC: ensure super admin has access to all companies (call from UI)
CREATE OR REPLACE FUNCTION ensure_super_admin_access(p_hours int DEFAULT 48)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sa_uid uuid;
  v_count  integer := 0;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can call this function';
  END IF;

  v_sa_uid := auth.uid();

  -- Expire any stale grants first
  UPDATE tenant_support_access
    SET status = 'expired'
  WHERE status = 'active' AND expires_at < now();

  -- Create grants for companies without active access
  INSERT INTO tenant_support_access (
    company_id, granted_by, granted_to, reason, scope, expires_at
  )
  SELECT
    c.id,
    v_sa_uid,
    v_sa_uid,
    'Platform maintenance — auto-granted',
    'full',
    now() + (p_hours || ' hours')::interval
  FROM companies c
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant_support_access t
    WHERE t.company_id = c.id
      AND t.granted_to = v_sa_uid
      AND t.status = 'active'
      AND t.expires_at > now()
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- RPC: extend an existing or create new grant for a specific company
CREATE OR REPLACE FUNCTION extend_support_access(
  p_company_id uuid,
  p_hours int DEFAULT 48
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grant_id uuid;
  v_actor    uuid;
BEGIN
  v_actor := auth.uid();

  -- Either the super admin self-extends or a company admin grants
  IF NOT (is_super_admin() OR is_my_company(p_company_id)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Expire old grants for this company
  UPDATE tenant_support_access
    SET status = 'expired'
  WHERE company_id = p_company_id
    AND granted_to = CASE WHEN is_super_admin() THEN v_actor ELSE get_super_admin_uid() END
    AND status = 'active';

  -- Create new grant
  INSERT INTO tenant_support_access (
    company_id, granted_by, granted_to, reason, scope, expires_at
  ) VALUES (
    p_company_id,
    v_actor,
    CASE WHEN is_super_admin() THEN v_actor ELSE get_super_admin_uid() END,
    CASE WHEN is_super_admin() THEN 'Platform maintenance — extended' ELSE 'Company admin granted access' END,
    'full',
    now() + (p_hours || ' hours')::interval
  )
  RETURNING id INTO v_grant_id;

  PERFORM log_gdpr_action(
    p_company_id, 'tenant_support_access', v_grant_id::text, 'GRANT_ACCESS',
    NULL,
    jsonb_build_object('granted_by', v_actor, 'hours', p_hours)
  );

  RETURN v_grant_id;
END;
$$;
