-- F-015: Lock down SECURITY DEFINER functions missing auth checks
-- F-016: Lock down Enterprise AI usage/audit tables

-- ═══════════════════════════════════════════════════════════════════════════════
-- F-015: AI usage functions — service_role only (called by edge functions)
-- ═══════════════════════════════════════════════════════════════════════════════

-- get_ai_usage: revoke from everyone, grant service_role, add search_path
REVOKE EXECUTE ON FUNCTION get_ai_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_ai_usage(UUID) TO service_role;

CREATE OR REPLACE FUNCTION get_ai_usage(p_company_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE result JSON;
BEGIN
  SELECT json_build_object(
    'monthly_queries_used', COALESCE(monthly_queries_used, 0),
    'monthly_queries_limit', COALESCE(monthly_queries_limit, 100),
    'monthly_tokens_used', COALESCE(monthly_tokens_used, 0)
  ) INTO result
  FROM company_features
  WHERE company_id = p_company_id AND feature_key = 'ai_help_agent';
  RETURN COALESCE(result, '{"monthly_queries_used":0,"monthly_queries_limit":100,"monthly_tokens_used":0}'::json);
END;
$$;

REVOKE EXECUTE ON FUNCTION get_ai_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_ai_usage(UUID) TO service_role;

-- increment_ai_usage: revoke from everyone, grant service_role, add search_path
CREATE OR REPLACE FUNCTION increment_ai_usage(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE company_features
  SET monthly_queries_used = COALESCE(monthly_queries_used, 0) + 1
  WHERE company_id = p_company_id
    AND feature_key = 'ai_help_agent';
END;
$$;

REVOKE EXECUTE ON FUNCTION increment_ai_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_ai_usage(UUID) TO service_role;

-- increment_ai_token_usage: revoke from everyone, grant service_role, add search_path
CREATE OR REPLACE FUNCTION increment_ai_token_usage(p_company_id UUID, p_tokens BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE company_features
  SET monthly_tokens_used = COALESCE(monthly_tokens_used, 0) + p_tokens
  WHERE company_id = p_company_id
    AND feature_key = 'ai_help_agent';
END;
$$;

REVOKE EXECUTE ON FUNCTION increment_ai_token_usage(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_ai_token_usage(UUID, BIGINT) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- F-015: Payroll ID functions — add company ownership check
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION generate_payroll_prefix(p_company_id uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM company_users
    WHERE auth_user_id = auth.uid()
      AND company_id = p_company_id
      AND role IN ('admin', 'hr')
  ) THEN
    RAISE EXCEPTION 'Forbidden — admin or HR role required for this company';
  END IF;

  SELECT company_name INTO v_name FROM companies WHERE id = p_company_id;
  IF v_name IS NULL THEN RETURN 'PAY'; END IF;
  v_prefix := upper(regexp_replace(v_name, '[^A-Za-z]', '', 'g'));
  v_prefix := substring(v_prefix FROM 1 FOR 3);
  IF length(v_prefix) < 2 THEN v_prefix := 'PAY'; END IF;
  RETURN v_prefix;
END;
$$;

CREATE OR REPLACE FUNCTION next_payroll_id(p_company_id uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq INT;
  v_prefix TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM company_users
    WHERE auth_user_id = auth.uid()
      AND company_id = p_company_id
      AND role IN ('admin', 'hr')
  ) THEN
    RAISE EXCEPTION 'Forbidden — admin or HR role required for this company';
  END IF;

  UPDATE companies SET payroll_seq = COALESCE(payroll_seq, 0) + 1
  WHERE id = p_company_id
  RETURNING payroll_seq INTO v_seq;

  v_prefix := generate_payroll_prefix(p_company_id);
  RETURN v_prefix || '-' || lpad(v_seq::text, 5, '0');
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- F-015: Cron function — service_role only
-- ═══════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION process_new_starter_announcements() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_new_starter_announcements() TO service_role;

-- Add search_path to the cron function
CREATE OR REPLACE FUNCTION process_new_starter_announcements()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT e.id AS employee_id, e.company_id, e.first_name, e.last_name,
           e.department, e.job_title, e.start_date
    FROM employees e
    LEFT JOIN announcements a ON a.company_id = e.company_id
      AND a.announcement_type = 'new_starter'
      AND a.metadata->>'employee_id' = e.id::text
    WHERE e.start_date <= CURRENT_DATE
      AND e.start_date >= CURRENT_DATE - INTERVAL '7 days'
      AND e.employment_status = 'active'
      AND a.id IS NULL
  LOOP
    INSERT INTO announcements (company_id, title, content, announcement_type, is_active, metadata, created_by)
    VALUES (
      r.company_id,
      'Welcome ' || r.first_name || ' ' || r.last_name || '!',
      r.first_name || ' has joined ' || COALESCE(r.department, 'the team') || ' as ' || COALESCE(r.job_title, 'a new team member') || '. Please give them a warm welcome!',
      'new_starter',
      true,
      jsonb_build_object('employee_id', r.employee_id, 'start_date', r.start_date),
      '00000000-0000-0000-0000-000000000000'
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION process_new_starter_announcements() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_new_starter_announcements() TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- F-016: Enterprise AI — lock down usage/audit writes to service_role
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS eai_usage_upsert ON enterprise_ai_usage;
DROP POLICY IF EXISTS eai_usage_update ON enterprise_ai_usage;
DROP POLICY IF EXISTS eai_audit_insert ON enterprise_ai_audit;

ALTER TABLE enterprise_ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_ai_audit ENABLE ROW LEVEL SECURITY;

-- Usage: only service_role can write (edge functions use service_role key)
-- Admins/HR can still read usage stats
CREATE POLICY eai_usage_select ON enterprise_ai_usage
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.auth_user_id = auth.uid()
        AND cu.company_id = enterprise_ai_usage.company_id
        AND cu.role IN ('admin', 'hr')
        AND cu.is_active = true
    )
  );

-- Audit: only service_role can write
CREATE POLICY eai_audit_select ON enterprise_ai_audit
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM company_users cu
      WHERE cu.auth_user_id = auth.uid()
        AND cu.company_id = enterprise_ai_audit.company_id
        AND cu.role IN ('admin', 'hr')
        AND cu.is_active = true
    )
  );

-- Validate ai_endpoint format
ALTER TABLE enterprise_ai_integrations
  DROP CONSTRAINT IF EXISTS eai_endpoint_azure_check;
ALTER TABLE enterprise_ai_integrations
  ADD CONSTRAINT eai_endpoint_azure_check
  CHECK (ai_endpoint IS NULL OR ai_endpoint ~ '^https://[a-zA-Z0-9-]+\.openai\.azure\.com');
