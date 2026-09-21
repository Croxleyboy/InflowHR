-- Migration 104: Fix log_gdpr_action calls in support access functions
-- Both batch_grant_preauthorised_access and extend_support_access were
-- calling log_gdpr_action with 10 arguments instead of the correct 8.

-- ============================================================
-- 1. Fix batch_grant_preauthorised_access
-- ============================================================

CREATE OR REPLACE FUNCTION batch_grant_preauthorised_access(p_hours int DEFAULT 48)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sa_uid uuid;
  v_company record;
  v_granted int := 0;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can call this function';
  END IF;

  v_sa_uid := auth.uid();

  -- Expire any stale grants first
  UPDATE tenant_support_access
  SET status = 'expired'
  WHERE granted_to = v_sa_uid
    AND status = 'active'
    AND expires_at < now();

  -- Only grant access to companies that have pre-authorised support access
  FOR v_company IN
    SELECT id FROM companies WHERE support_access_authorised = true
  LOOP
    -- Skip if already has active grant
    IF EXISTS (
      SELECT 1 FROM tenant_support_access
      WHERE company_id = v_company.id
        AND granted_to = v_sa_uid
        AND status = 'active'
        AND expires_at > now()
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO tenant_support_access (
      company_id, granted_by, granted_to,
      scope, reason, expires_at, status
    ) VALUES (
      v_company.id, v_sa_uid, v_sa_uid,
      'read_only', 'Pre-authorised support access',
      now() + make_interval(hours => p_hours), 'active'
    );

    v_granted := v_granted + 1;

    -- Audit log the self-grant (correct 8-parameter signature)
    PERFORM log_gdpr_action(
      v_company.id,
      'tenant_support_access',
      v_sa_uid::text,
      'SELF_GRANT_ACCESS',
      NULL,
      NULL,
      NULL,
      jsonb_build_object(
        'scope', 'read_only',
        'reason', 'Pre-authorised support access',
        'expires_at', (now() + make_interval(hours => p_hours))::text,
        'pre_authorised', true
      )
    );
  END LOOP;

  RETURN v_granted;
END;
$$;


-- ============================================================
-- 2. Fix extend_support_access
-- ============================================================

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

  IF NOT (is_super_admin() OR is_my_company(p_company_id)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Super admin self-grants require company pre-authorisation
  IF is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM companies WHERE id = p_company_id AND support_access_authorised = true
  ) THEN
    RAISE EXCEPTION 'Company has not pre-authorised support access';
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
    CASE WHEN is_super_admin() THEN 'Pre-authorised support access — extended' ELSE 'Company admin granted access' END,
    'read_only',
    now() + make_interval(hours => p_hours)
  )
  RETURNING id INTO v_grant_id;

  -- Audit log (correct 8-parameter signature)
  PERFORM log_gdpr_action(
    p_company_id,
    'tenant_support_access',
    v_grant_id::text,
    'SELF_GRANT_ACCESS',
    NULL,
    NULL,
    v_grant_id,
    jsonb_build_object(
      'scope', 'read_only',
      'hours', p_hours,
      'pre_authorised', true
    )
  );

  RETURN v_grant_id;
END;
$$;


-- ============================================================
-- 3. Security: REVOKE / GRANT
-- ============================================================

REVOKE ALL ON FUNCTION batch_grant_preauthorised_access(int) FROM anon;
GRANT EXECUTE ON FUNCTION batch_grant_preauthorised_access(int) TO authenticated;

REVOKE ALL ON FUNCTION extend_support_access(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION extend_support_access(uuid, int) TO authenticated;
