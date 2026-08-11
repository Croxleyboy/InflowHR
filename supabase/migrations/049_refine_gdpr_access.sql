-- ============================================================
-- 049: Refine GDPR access levels
--
-- Problem: 047 gated ALL tenant tables behind support access,
-- but the super admin (platform operator) needs operational
-- visibility for billing, metrics, and service tickets even
-- when support access is revoked.
--
-- Solution: Three tiers of access:
--   1. PII tables — gated by can_access_company() (support grant required)
--   2. Config/billing tables — super admin always has access
--   3. HR tickets — super admin sees provider-assigned tickets only
--   4. Metrics RPC — aggregate counts without PII exposure
-- ============================================================

-- ──────────────────────────────────────────
-- TIER 2: Config/billing tables
-- Super admin always needs these for platform management
-- ──────────────────────────────────────────

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'company_features',
    'leave_types',
    'benefit_types',
    'benefit_options',
    'shift_templates',
    'company_elearning_courses',
    'legal_clients',
    'legal_matters',
    'customer_projects',
    'app_settings',
    'announcements'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped insert" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped update" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped delete" ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY "Company scoped read" ON %I FOR SELECT
       USING (can_access_company(company_id) OR is_super_admin())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped insert" ON %I FOR INSERT
       WITH CHECK (can_access_company(company_id) OR is_super_admin())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped update" ON %I FOR UPDATE
       USING (can_access_company(company_id) OR is_super_admin())', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped delete" ON %I FOR DELETE
       USING (can_access_company(company_id) OR is_super_admin())', tbl);
  END LOOP;
END $$;


-- ──────────────────────────────────────────
-- TIER 3: HR tickets — service provider assignment
-- Super admin can always see tickets assigned to provider
-- ──────────────────────────────────────────

ALTER TABLE hr_tickets ADD COLUMN IF NOT EXISTS assigned_to_provider boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Company scoped read" ON hr_tickets;
DROP POLICY IF EXISTS "Company scoped insert" ON hr_tickets;
DROP POLICY IF EXISTS "Company scoped update" ON hr_tickets;
DROP POLICY IF EXISTS "Company scoped delete" ON hr_tickets;

CREATE POLICY "Company scoped read" ON hr_tickets FOR SELECT
  USING (can_access_company(company_id) OR (is_super_admin() AND assigned_to_provider = true));
CREATE POLICY "Company scoped insert" ON hr_tickets FOR INSERT
  WITH CHECK (can_access_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON hr_tickets FOR UPDATE
  USING (can_access_company(company_id) OR (is_super_admin() AND assigned_to_provider = true));
CREATE POLICY "Company scoped delete" ON hr_tickets FOR DELETE
  USING (can_access_company(company_id));


-- ──────────────────────────────────────────
-- TIER 4: Aggregate metrics RPC
-- Returns counts per company without exposing PII
-- Super admin uses this for dashboard and billing
-- ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_all_company_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can call this function';
  END IF;

  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'company_id', c.id,
      'company_name', c.name,
      'employee_count', COALESCE((SELECT count(*) FROM employees e WHERE e.company_id = c.id AND e.is_active = true), 0),
      'total_employees', COALESCE((SELECT count(*) FROM employees e WHERE e.company_id = c.id), 0),
      'active_users', COALESCE((SELECT count(*) FROM company_users cu WHERE cu.company_id = c.id AND cu.is_active = true), 0),
      'open_tickets', COALESCE((SELECT count(*) FROM hr_tickets ht WHERE ht.company_id = c.id AND ht.status IN ('open', 'in_progress')), 0),
      'provider_tickets', COALESCE((SELECT count(*) FROM hr_tickets ht WHERE ht.company_id = c.id AND ht.assigned_to_provider = true AND ht.status IN ('open', 'in_progress')), 0),
      'pending_expenses', COALESCE((SELECT count(*) FROM expense_claims ec WHERE ec.company_id = c.id AND ec.status = 'pending'), 0),
      'pending_leave', COALESCE((SELECT count(*) FROM leave_requests lr WHERE lr.company_id = c.id AND lr.status = 'pending'), 0),
      'pending_onboarding', COALESCE((SELECT count(*) FROM onboarding o WHERE o.company_id = c.id AND o.status = 'new'), 0)
    ))
    FROM companies c
  );
END;
$$;

-- Single company metrics (for billing page)
CREATE OR REPLACE FUNCTION get_company_metrics(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_super_admin() OR is_my_company(p_company_id)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN jsonb_build_object(
    'employee_count', COALESCE((SELECT count(*) FROM employees WHERE company_id = p_company_id AND is_active = true), 0),
    'total_employees', COALESCE((SELECT count(*) FROM employees WHERE company_id = p_company_id), 0),
    'active_users', COALESCE((SELECT count(*) FROM company_users WHERE company_id = p_company_id AND is_active = true), 0),
    'open_tickets', COALESCE((SELECT count(*) FROM hr_tickets WHERE company_id = p_company_id AND status IN ('open', 'in_progress')), 0),
    'pending_expenses', COALESCE((SELECT count(*) FROM expense_claims WHERE company_id = p_company_id AND status = 'pending'), 0),
    'pending_leave', COALESCE((SELECT count(*) FROM leave_requests WHERE company_id = p_company_id AND status = 'pending'), 0),
    'pending_onboarding', COALESCE((SELECT count(*) FROM onboarding WHERE company_id = p_company_id AND status = 'new'), 0)
  );
END;
$$;
