-- 236: MSP Partner Channel — Foundation (Phase 1)
-- Adds MSP multi-tenant management layer on top of existing company isolation.
-- Feature is OFF by default (platform_settings.msp_feature_enabled = 'false').
-- Rollback: revert is_my_company(), drop new tables/columns, delete platform_settings row.


-- ============================================================
-- 1. Platform Settings table (global key-value, not per-company)
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage platform settings"
  ON platform_settings FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

INSERT INTO platform_settings (key, value)
VALUES ('msp_feature_enabled', 'false')
ON CONFLICT (key) DO NOTHING;


-- ============================================================
-- 2. New columns on companies
-- ============================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_msp BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS msp_tier TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS msp_wholesale_discount NUMERIC(5,2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS msp_branding JSONB;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS managed_by_msp_id UUID REFERENCES companies(id);


-- ============================================================
-- 3. MSP ↔ Managed Company relationship
-- ============================================================

CREATE TABLE msp_managed_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  msp_company_id UUID NOT NULL REFERENCES companies(id),
  managed_company_id UUID NOT NULL REFERENCES companies(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  added_at TIMESTAMPTZ DEFAULT now(),
  added_by UUID REFERENCES auth.users(id),
  UNIQUE(msp_company_id, managed_company_id),
  CHECK(msp_company_id != managed_company_id)
);

CREATE INDEX idx_msp_managed_msp ON msp_managed_companies(msp_company_id) WHERE is_active = true;
CREATE INDEX idx_msp_managed_company ON msp_managed_companies(managed_company_id) WHERE is_active = true;

ALTER TABLE msp_managed_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins full access to msp_managed_companies"
  ON msp_managed_companies FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "MSP admins can read their own managed companies"
  ON msp_managed_companies FOR SELECT
  USING (
    msp_company_id IN (
      SELECT cu.company_id FROM company_users cu
      WHERE cu.auth_user_id = auth.uid() AND cu.is_active = true
    )
  );


-- ============================================================
-- 4. MSP User Access (which MSP employees can access which managed companies)
-- ============================================================

CREATE TABLE msp_user_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  msp_company_id UUID NOT NULL REFERENCES companies(id),
  managed_company_id UUID NOT NULL REFERENCES companies(id),
  permissions JSONB NOT NULL DEFAULT '{"full_admin": true}'::jsonb,
  granted_at TIMESTAMPTZ DEFAULT now(),
  granted_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(employee_id, managed_company_id)
);

CREATE INDEX idx_msp_user_access_employee ON msp_user_access(employee_id) WHERE is_active = true;
CREATE INDEX idx_msp_user_access_managed ON msp_user_access(managed_company_id) WHERE is_active = true;

ALTER TABLE msp_user_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins full access to msp_user_access"
  ON msp_user_access FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "MSP admins can read access for their MSP company"
  ON msp_user_access FOR SELECT
  USING (
    msp_company_id IN (
      SELECT cu.company_id FROM company_users cu
      WHERE cu.auth_user_id = auth.uid() AND cu.is_active = true
    )
  );

CREATE POLICY "MSP admins with full_admin can manage access for their MSP"
  ON msp_user_access FOR ALL
  USING (
    msp_company_id IN (
      SELECT mua2.msp_company_id FROM msp_user_access mua2
      JOIN employees e ON e.id = mua2.employee_id
      WHERE e.auth_user_id = auth.uid()
        AND mua2.is_active = true
        AND (mua2.permissions->>'full_admin')::boolean = true
    )
  )
  WITH CHECK (
    msp_company_id IN (
      SELECT mua2.msp_company_id FROM msp_user_access mua2
      JOIN employees e ON e.id = mua2.employee_id
      WHERE e.auth_user_id = auth.uid()
        AND mua2.is_active = true
        AND (mua2.permissions->>'full_admin')::boolean = true
    )
  );


-- ============================================================
-- 5. MSP Audit Log
-- ============================================================

CREATE TABLE msp_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  msp_company_id UUID NOT NULL,
  managed_company_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_msp_audit_log_msp ON msp_audit_log(msp_company_id, created_at DESC);
CREATE INDEX idx_msp_audit_log_managed ON msp_audit_log(managed_company_id, created_at DESC);

ALTER TABLE msp_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins full access to msp_audit_log"
  ON msp_audit_log FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "MSP admins can read their own audit log"
  ON msp_audit_log FOR SELECT
  USING (
    msp_company_id IN (
      SELECT cu.company_id FROM company_users cu
      WHERE cu.auth_user_id = auth.uid() AND cu.is_active = true
    )
  );

CREATE POLICY "MSP admins can insert audit log entries"
  ON msp_audit_log FOR INSERT
  WITH CHECK (
    msp_company_id IN (
      SELECT mua.msp_company_id FROM msp_user_access mua
      JOIN employees e ON e.id = mua.employee_id
      WHERE e.auth_user_id = auth.uid() AND mua.is_active = true
    )
  );


-- ============================================================
-- 6. Core SQL Functions
-- ============================================================

-- Check if current user is an MSP admin for any company
CREATE OR REPLACE FUNCTION is_msp_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM msp_user_access mua
    JOIN employees e ON e.id = mua.employee_id
    WHERE e.auth_user_id = auth.uid()
      AND mua.is_active = true
  );
$$;

-- Check if current user is an MSP admin for a specific managed company
CREATE OR REPLACE FUNCTION is_msp_for_company(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM msp_user_access mua
    JOIN employees e ON e.id = mua.employee_id
    JOIN msp_managed_companies mmc ON mmc.msp_company_id = mua.msp_company_id
      AND mmc.managed_company_id = mua.managed_company_id
    WHERE e.auth_user_id = auth.uid()
      AND mua.managed_company_id = p_company_id
      AND mua.is_active = true
      AND mmc.is_active = true
  );
$$;

-- Get the MSP company ID for the current user (NULL if not an MSP admin)
CREATE OR REPLACE FUNCTION get_msp_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mua.msp_company_id FROM msp_user_access mua
  JOIN employees e ON e.id = mua.employee_id
  WHERE e.auth_user_id = auth.uid()
    AND mua.is_active = true
  LIMIT 1;
$$;


-- ============================================================
-- 7. EXTEND is_my_company() — the ONLY change to existing logic
--    Includes global kill switch via platform_settings
-- ============================================================

CREATE OR REPLACE FUNCTION is_my_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE auth_user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = true
  )
  OR (
    -- MSP access: only active when feature is globally enabled
    EXISTS (
      SELECT 1 FROM platform_settings
      WHERE key = 'msp_feature_enabled' AND value = 'true'
    )
    AND EXISTS (
      SELECT 1 FROM msp_user_access mua
      JOIN employees e ON e.id = mua.employee_id
      JOIN msp_managed_companies mmc ON mmc.msp_company_id = mua.msp_company_id
        AND mmc.managed_company_id = mua.managed_company_id
      WHERE e.auth_user_id = auth.uid()
        AND mua.managed_company_id = p_company_id
        AND mua.is_active = true
        AND mmc.is_active = true
    )
  );
$$;


-- ============================================================
-- 8. MSP Management RPCs
-- ============================================================

-- Create a new managed company for an MSP
CREATE OR REPLACE FUNCTION create_msp_managed_company(
  p_msp_company_id UUID,
  p_company_name TEXT,
  p_company_domain TEXT DEFAULT NULL,
  p_admin_email TEXT DEFAULT NULL,
  p_admin_first_name TEXT DEFAULT NULL,
  p_admin_last_name TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_company_id UUID;
  v_caller_employee_id UUID;
BEGIN
  -- Only super admins or MSP admins with full_admin can create managed companies
  IF NOT is_super_admin() THEN
    SELECT e.id INTO v_caller_employee_id
    FROM employees e
    JOIN msp_user_access mua ON mua.employee_id = e.id
    WHERE e.auth_user_id = auth.uid()
      AND mua.msp_company_id = p_msp_company_id
      AND mua.is_active = true
      AND (mua.permissions->>'full_admin')::boolean = true
    LIMIT 1;

    IF v_caller_employee_id IS NULL THEN
      RAISE EXCEPTION 'Access denied: must be super admin or MSP full admin';
    END IF;
  END IF;

  -- Verify the MSP company exists and is flagged as MSP
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_msp_company_id AND is_msp = true) THEN
    RAISE EXCEPTION 'Company is not an MSP';
  END IF;

  -- Create the new company
  INSERT INTO companies (name, domain)
  VALUES (p_company_name, p_company_domain)
  RETURNING id INTO v_new_company_id;

  -- Set managed_by_msp_id on the new company
  UPDATE companies SET managed_by_msp_id = p_msp_company_id WHERE id = v_new_company_id;

  -- Link MSP to managed company
  INSERT INTO msp_managed_companies (msp_company_id, managed_company_id, added_by)
  VALUES (p_msp_company_id, v_new_company_id, auth.uid());

  -- Insert default company features (core features enabled)
  INSERT INTO company_features (company_id, feature_key, is_enabled)
  SELECT v_new_company_id, feature_key, true
  FROM (VALUES ('core_hr'), ('leave_management'), ('employee_help')) AS defaults(feature_key);

  -- Audit log
  INSERT INTO msp_audit_log (msp_company_id, managed_company_id, actor_id, action, details)
  VALUES (p_msp_company_id, v_new_company_id, auth.uid(), 'company_created',
    jsonb_build_object('company_name', p_company_name, 'admin_email', p_admin_email));

  RETURN jsonb_build_object(
    'success', true,
    'company_id', v_new_company_id,
    'company_name', p_company_name
  );
END;
$$;


-- Grant MSP user access to a managed company
CREATE OR REPLACE FUNCTION grant_msp_user_access(
  p_employee_id UUID,
  p_msp_company_id UUID,
  p_managed_company_id UUID,
  p_permissions JSONB DEFAULT '{"full_admin": true}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    -- Check caller is MSP full_admin
    IF NOT EXISTS (
      SELECT 1 FROM msp_user_access mua
      JOIN employees e ON e.id = mua.employee_id
      WHERE e.auth_user_id = auth.uid()
        AND mua.msp_company_id = p_msp_company_id
        AND mua.is_active = true
        AND (mua.permissions->>'full_admin')::boolean = true
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  -- Verify the managed company relationship exists
  IF NOT EXISTS (
    SELECT 1 FROM msp_managed_companies
    WHERE msp_company_id = p_msp_company_id
      AND managed_company_id = p_managed_company_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Not a managed company for this MSP';
  END IF;

  -- Verify the employee belongs to the MSP company
  IF NOT EXISTS (
    SELECT 1 FROM employees WHERE id = p_employee_id AND company_id = p_msp_company_id
  ) THEN
    RAISE EXCEPTION 'Employee does not belong to MSP company';
  END IF;

  -- Upsert access
  INSERT INTO msp_user_access (employee_id, msp_company_id, managed_company_id, permissions, granted_by)
  VALUES (p_employee_id, p_msp_company_id, p_managed_company_id, p_permissions, auth.uid())
  ON CONFLICT (employee_id, managed_company_id)
  DO UPDATE SET permissions = p_permissions, granted_by = auth.uid(), is_active = true, granted_at = now();

  -- Audit
  INSERT INTO msp_audit_log (msp_company_id, managed_company_id, actor_id, action, details)
  VALUES (p_msp_company_id, p_managed_company_id, auth.uid(), 'access_granted',
    jsonb_build_object('employee_id', p_employee_id, 'permissions', p_permissions));

  RETURN jsonb_build_object('success', true);
END;
$$;


-- Revoke MSP user access
CREATE OR REPLACE FUNCTION revoke_msp_user_access(
  p_employee_id UUID,
  p_managed_company_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msp_company_id UUID;
BEGIN
  -- Get the MSP company for this access row
  SELECT msp_company_id INTO v_msp_company_id
  FROM msp_user_access
  WHERE employee_id = p_employee_id AND managed_company_id = p_managed_company_id;

  IF v_msp_company_id IS NULL THEN
    RAISE EXCEPTION 'Access record not found';
  END IF;

  IF NOT is_super_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM msp_user_access mua
      JOIN employees e ON e.id = mua.employee_id
      WHERE e.auth_user_id = auth.uid()
        AND mua.msp_company_id = v_msp_company_id
        AND mua.is_active = true
        AND (mua.permissions->>'full_admin')::boolean = true
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  -- Soft-delete: set is_active = false
  UPDATE msp_user_access
  SET is_active = false
  WHERE employee_id = p_employee_id AND managed_company_id = p_managed_company_id;

  -- Audit
  INSERT INTO msp_audit_log (msp_company_id, managed_company_id, actor_id, action, details)
  VALUES (v_msp_company_id, p_managed_company_id, auth.uid(), 'access_revoked',
    jsonb_build_object('employee_id', p_employee_id));

  RETURN jsonb_build_object('success', true);
END;
$$;


-- Get MSP dashboard data (list managed companies with stats)
CREATE OR REPLACE FUNCTION get_msp_dashboard(p_msp_company_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_super_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM msp_user_access mua
      JOIN employees e ON e.id = mua.employee_id
      WHERE e.auth_user_id = auth.uid()
        AND mua.msp_company_id = p_msp_company_id
        AND mua.is_active = true
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'msp_company', (SELECT to_jsonb(c) FROM companies c WHERE c.id = p_msp_company_id),
    'managed_companies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', mc.id,
        'company_id', mc.managed_company_id,
        'company_name', co.name,
        'is_active', mc.is_active,
        'added_at', mc.added_at,
        'employee_count', (SELECT COUNT(*) FROM employees e WHERE e.company_id = mc.managed_company_id AND e.status = 'active'),
        'active_packs', (SELECT COUNT(*) FROM company_features cf WHERE cf.company_id = mc.managed_company_id AND cf.is_enabled = true AND cf.feature_key LIKE 'pack_%')
      ))
      FROM msp_managed_companies mc
      JOIN companies co ON co.id = mc.managed_company_id
      WHERE mc.msp_company_id = p_msp_company_id AND mc.is_active = true
    ), '[]'::jsonb),
    'total_employees', (
      SELECT COALESCE(SUM(cnt), 0) FROM (
        SELECT COUNT(*) as cnt FROM employees e
        JOIN msp_managed_companies mc ON mc.managed_company_id = e.company_id
        WHERE mc.msp_company_id = p_msp_company_id AND mc.is_active = true AND e.status = 'active'
      ) sub
    ),
    'msp_users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'employee_id', mua.employee_id,
        'employee_name', e.first_name || ' ' || e.last_name,
        'managed_company_id', mua.managed_company_id,
        'managed_company_name', co.name,
        'permissions', mua.permissions
      ))
      FROM msp_user_access mua
      JOIN employees e ON e.id = mua.employee_id
      JOIN companies co ON co.id = mua.managed_company_id
      WHERE mua.msp_company_id = p_msp_company_id AND mua.is_active = true
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- ============================================================
-- 9. Update delete_company_data to include MSP tables
-- ============================================================

CREATE OR REPLACE FUNCTION delete_company_data(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can delete company data';
  END IF;

  -- MSP tables: remove relationships and access for this company
  DELETE FROM msp_audit_log WHERE managed_company_id = p_company_id OR msp_company_id = p_company_id;
  DELETE FROM msp_user_access WHERE managed_company_id = p_company_id OR msp_company_id = p_company_id;
  DELETE FROM msp_managed_companies WHERE managed_company_id = p_company_id OR msp_company_id = p_company_id;

  -- Existing deletions (unchanged)
  DELETE FROM billing_adjustments WHERE company_id = p_company_id;
  DELETE FROM feature_change_log WHERE company_id = p_company_id;
  DELETE FROM ai_help_usage WHERE company_id = p_company_id;
  DELETE FROM help_search_logs WHERE company_id = p_company_id;
  DELETE FROM help_articles WHERE company_id = p_company_id;
  DELETE FROM survey_responses WHERE survey_id IN (SELECT id FROM surveys WHERE company_id = p_company_id);
  DELETE FROM survey_questions WHERE survey_id IN (SELECT id FROM surveys WHERE company_id = p_company_id);
  DELETE FROM surveys WHERE company_id = p_company_id;
  DELETE FROM shift_corrections WHERE company_id = p_company_id;
  DELETE FROM shift_swap_requests WHERE company_id = p_company_id;
  DELETE FROM shift_assignments WHERE company_id = p_company_id;
  DELETE FROM shift_templates WHERE company_id = p_company_id;
  DELETE FROM rotas WHERE company_id = p_company_id;
  DELETE FROM payroll_audit_log WHERE company_id = p_company_id;
  DELETE FROM payslips WHERE company_id = p_company_id;
  DELETE FROM timesheet_entries WHERE company_id = p_company_id;
  DELETE FROM timesheets WHERE company_id = p_company_id;
  DELETE FROM check_in_records WHERE company_id = p_company_id;
  DELETE FROM check_in_policies WHERE company_id = p_company_id;
  DELETE FROM leave_requests WHERE company_id = p_company_id;
  DELETE FROM leave_balances WHERE company_id = p_company_id;
  DELETE FROM leave_types WHERE company_id = p_company_id;
  DELETE FROM expense_claims WHERE company_id = p_company_id;
  DELETE FROM expense_categories WHERE company_id = p_company_id;
  DELETE FROM performance_reviews WHERE company_id = p_company_id;
  DELETE FROM review_cycles WHERE company_id = p_company_id;
  DELETE FROM objectives WHERE company_id = p_company_id;
  DELETE FROM kudos WHERE company_id = p_company_id;
  DELETE FROM elearning_enrolments WHERE company_id = p_company_id;
  DELETE FROM elearning_courses WHERE company_id = p_company_id;
  DELETE FROM elearning_categories WHERE company_id = p_company_id;
  DELETE FROM benefit_enrolments WHERE company_id = p_company_id;
  DELETE FROM benefit_types WHERE company_id = p_company_id;
  DELETE FROM space_bookings WHERE company_id = p_company_id;
  DELETE FROM space_equipment WHERE company_id = p_company_id;
  DELETE FROM spaces WHERE company_id = p_company_id;
  DELETE FROM assets WHERE company_id = p_company_id;
  DELETE FROM asset_categories WHERE company_id = p_company_id;
  DELETE FROM skill_endorsements WHERE company_id = p_company_id;
  DELETE FROM employee_skills WHERE company_id = p_company_id;
  DELETE FROM skill_categories WHERE company_id = p_company_id;
  DELETE FROM employee_consents WHERE company_id = p_company_id;
  DELETE FROM notifications WHERE company_id = p_company_id;
  DELETE FROM onboarding_tasks WHERE company_id = p_company_id;
  DELETE FROM documents WHERE company_id = p_company_id;
  DELETE FROM company_teams_config WHERE company_id = p_company_id;
  DELETE FROM xero_integrations WHERE company_id = p_company_id;
  DELETE FROM sage_integrations WHERE company_id = p_company_id;
  DELETE FROM modulr_integrations WHERE company_id = p_company_id;
  DELETE FROM zero_hours_config WHERE company_id = p_company_id;
  DELETE FROM zero_hours_assessments WHERE company_id = p_company_id;
  DELETE FROM onboarding_workflow_settings WHERE company_id = p_company_id;
  DELETE FROM billing_snapshots WHERE company_id = p_company_id;
  DELETE FROM company_features WHERE company_id = p_company_id;
  DELETE FROM employees WHERE company_id = p_company_id;
  DELETE FROM company_users WHERE company_id = p_company_id;
  DELETE FROM companies WHERE id = p_company_id;
END;
$$;


-- ============================================================
-- 10. Update export_company_data to include MSP tables
-- ============================================================

CREATE OR REPLACE FUNCTION export_company_data(p_company_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_company jsonb;
  v_company_name text;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;
  SELECT to_jsonb(c) INTO v_company FROM companies c WHERE c.id = p_company_id;

  SELECT jsonb_build_object(
    'export_metadata', jsonb_build_object(
      'format',        'InflowHR Company Export v1',
      'exported_at',   now(),
      'company_id',    p_company_id,
      'company_name',  v_company_name,
      'gdpr_article',  'Art. 28(3)(g) — Return or delete all personal data after services end',
      'export_type',   'cancellation'
    ),

    'company',              v_company,
    'employees',            COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employees            r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'company_users',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_users        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'leave_types',          COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_types          r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'leave_requests',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_requests       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'leave_balances',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_balances       r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'payslips',             COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM payslips             r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'expense_claims',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_claims       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'expense_line_items',   COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_line_items   r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'timesheets',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM timesheets           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'performance_reviews',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM performance_reviews  r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'kudos',                COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM kudos                r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'benefits',             COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefits             r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_types',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_types        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_options',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_options      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_enrollments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_enrollments  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'employee_benefits',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_benefits    r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    'rotas',                COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM rotas                r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_templates',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_templates      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_assignments',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_assignments    r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_swap_requests',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_swap_requests  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'employee_availability',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_availability r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'legal_clients',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_clients        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'legal_matters',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_matters        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'legal_timesheet_entries', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_timesheet_entries r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'hr_tickets',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM hr_tickets           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'one_to_one_meetings',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_meetings  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'one_to_one_comments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_comments  r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'onboarding',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM onboarding           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'announcements',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM announcements        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'notifications',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM notifications        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'workflow_tracker',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM workflow_tracker     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'app_settings',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM app_settings         r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'company_features',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_features     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'company_elearning_courses', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_elearning_courses r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'courses',              COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM courses              r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'course_enrolments',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM course_enrolments    r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    'checkin_records',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM checkin_records      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'break_records',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM break_records        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'space_bookings',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM space_bookings       r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    'employee_skills',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_skills      r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'employee_certifications', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_certifications r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'skill_evidence',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM skill_evidence       r WHERE r.employee_skill_id IN (SELECT id FROM employee_skills WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id))), '[]'::jsonb),
    'skill_validations',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM skill_validations    r WHERE r.employee_skill_id IN (SELECT id FROM employee_skills WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id))), '[]'::jsonb),

    'company_assets',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_assets       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'asset_updates',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM asset_updates        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'employee_consents',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_consents    r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'billing_snapshots',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM billing_snapshots    r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'billing_adjustments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM billing_adjustments  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'feature_change_log',   COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM feature_change_log   r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'user_settings',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM user_settings        r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    'gdpr_audit_logs',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM gdpr_audit_logs     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'tenant_support_access', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM tenant_support_access r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- MSP data for this company
    'msp_managed_companies', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM msp_managed_companies r WHERE r.managed_company_id = p_company_id OR r.msp_company_id = p_company_id), '[]'::jsonb),
    'msp_user_access',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM msp_user_access      r WHERE r.managed_company_id = p_company_id OR r.msp_company_id = p_company_id), '[]'::jsonb),
    'msp_audit_log',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM msp_audit_log        r WHERE r.managed_company_id = p_company_id OR r.msp_company_id = p_company_id), '[]'::jsonb)
  ) INTO v_result;

  PERFORM log_gdpr_action(
    auth.uid(), 'super_admin', p_company_id,
    NULL, 'companies', p_company_id::text,
    'COMPANY_DATA_EXPORTED', NULL, NULL,
    jsonb_build_object(
      'export_type', 'cancellation',
      'gdpr_article', 'Art. 28(3)(g)'
    )
  );

  RETURN v_result;
END;
$$;


-- ============================================================
-- 11. Permissions
-- ============================================================

REVOKE EXECUTE ON FUNCTION is_msp_admin() FROM anon;
GRANT EXECUTE ON FUNCTION is_msp_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION is_msp_for_company(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION is_msp_for_company(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_msp_company_id() FROM anon;
GRANT EXECUTE ON FUNCTION get_msp_company_id() TO authenticated;

REVOKE EXECUTE ON FUNCTION create_msp_managed_company(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION create_msp_managed_company(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION grant_msp_user_access(UUID, UUID, UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION grant_msp_user_access(UUID, UUID, UUID, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION revoke_msp_user_access(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION revoke_msp_user_access(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_msp_dashboard(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_msp_dashboard(UUID) TO authenticated;
