-- ============================================================
-- 047: GDPR Compliance — Support Access, Audit Logging, DSR
--
-- Implements:
--   1. Consent-based support access (Art. 6, Art. 28)
--   2. Immutable audit logging (Art. 30, Art. 32)
--   3. RLS policy hardening — super_admin gated by support grant
--   4. Data Subject Rights: export (Art. 20) + anonymise (Art. 17)
--   5. Automatic expiry of support access grants
-- ============================================================


-- ============================================================
-- 1. SUPPORT ACCESS GRANT TABLE
--    GDPR Art. 6(1)(a) — Lawful basis: explicit consent
--    GDPR Art. 28     — Processor access only under controller instruction
--    GDPR Art. 5(1)(e) — Storage limitation: time-bound TTL
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_support_access (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  granted_by      uuid NOT NULL,       -- auth.uid() of company_admin granting access
  granted_to      uuid NOT NULL,       -- auth.uid() of super_admin receiving access
  reason          text NOT NULL,       -- purpose limitation (Art. 5(1)(b))
  scope           text NOT NULL DEFAULT 'read_only'
                    CHECK (scope IN ('read_only', 'read_write', 'full')),
  expires_at      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'revoked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      uuid
);

CREATE INDEX IF NOT EXISTS idx_support_access_company  ON tenant_support_access(company_id);
CREATE INDEX IF NOT EXISTS idx_support_access_status   ON tenant_support_access(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_support_access_grantee  ON tenant_support_access(granted_to);

ALTER TABLE tenant_support_access ENABLE ROW LEVEL SECURITY;

-- Company admins can view/manage their own grants; super admin sees grants issued to them
CREATE POLICY "Support access - company admin read" ON tenant_support_access
  FOR SELECT USING (is_my_company(company_id) OR granted_to = auth.uid());
CREATE POLICY "Support access - company admin insert" ON tenant_support_access
  FOR INSERT WITH CHECK (is_my_company(company_id));
CREATE POLICY "Support access - company admin update" ON tenant_support_access
  FOR UPDATE USING (is_my_company(company_id));

-- Note: lazy expiry trigger removed — it caused infinite recursion
-- (UPDATE inside trigger re-fires the trigger). Expiry is handled by:
--   1. has_active_support_access() checks expires_at > now()
--   2. ensure_super_admin_access() expires stale rows before inserting


-- ============================================================
-- 2. HELPER: has_active_support_access(company_id)
--    Returns TRUE only when an active, non-expired grant exists
--    for the calling super_admin on the given company.
-- ============================================================

CREATE OR REPLACE FUNCTION has_active_support_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_support_access
    WHERE company_id  = p_company_id
      AND granted_to  = auth.uid()
      AND status      = 'active'
      AND expires_at  > now()
  );
$$;


-- ============================================================
-- 3. IMMUTABLE AUDIT LOG
--    GDPR Art. 30 — Records of processing activities
--    GDPR Art. 32 — Security: tamper-proof logging
-- ============================================================

CREATE TABLE IF NOT EXISTS gdpr_audit_logs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  performed_at      timestamptz NOT NULL DEFAULT now(),
  actor_id          uuid NOT NULL,          -- auth.uid() of the actor
  actor_role        text NOT NULL,          -- 'super_admin' | 'company_admin' | 'employee'
  company_id        uuid REFERENCES companies(id),
  support_access_id uuid REFERENCES tenant_support_access(id),
  table_name        text NOT NULL,
  record_id         text,                   -- PK of affected row
  action            text NOT NULL
                      CHECK (action IN ('SELECT','INSERT','UPDATE','DELETE',
                                        'EXPORT','ANONYMISE','GRANT_ACCESS','REVOKE_ACCESS')),
  old_data          jsonb,
  new_data          jsonb,
  metadata          jsonb                   -- IP, user-agent, etc.
);

CREATE INDEX IF NOT EXISTS idx_audit_actor     ON gdpr_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_company   ON gdpr_audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_performed ON gdpr_audit_logs(performed_at);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON gdpr_audit_logs(action);

ALTER TABLE gdpr_audit_logs ENABLE ROW LEVEL SECURITY;

-- Append-only: INSERT allowed, no UPDATE or DELETE policies
CREATE POLICY "Audit log - insert only" ON gdpr_audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- Super admin sees all logs; company admin sees own company logs
CREATE POLICY "Audit log - read" ON gdpr_audit_logs
  FOR SELECT TO authenticated
  USING (is_super_admin() OR is_my_company(company_id));

-- Explicitly block UPDATE and DELETE — no policies = denied by RLS
-- Additional safeguard: revoke at role level
REVOKE UPDATE, DELETE ON gdpr_audit_logs FROM authenticated;
REVOKE UPDATE, DELETE ON gdpr_audit_logs FROM anon;


-- ============================================================
-- 4. AUDIT LOGGING HELPER FUNCTION
--    Call from application code when super_admin performs actions
-- ============================================================

CREATE OR REPLACE FUNCTION log_gdpr_action(
  p_company_id        uuid,
  p_table_name        text,
  p_record_id         text,
  p_action            text,
  p_old_data          jsonb DEFAULT NULL,
  p_new_data          jsonb DEFAULT NULL,
  p_support_access_id uuid DEFAULT NULL,
  p_metadata          jsonb DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_log_id bigint;
BEGIN
  IF is_super_admin() THEN
    v_role := 'super_admin';
  ELSE
    v_role := 'company_admin';
  END IF;

  INSERT INTO gdpr_audit_logs (
    actor_id, actor_role, company_id, support_access_id,
    table_name, record_id, action, old_data, new_data, metadata
  ) VALUES (
    auth.uid(), v_role, p_company_id, p_support_access_id,
    p_table_name, p_record_id, p_action, p_old_data, p_new_data, p_metadata
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;


-- ============================================================
-- 5. RLS POLICY HARDENING
--    Replace blanket is_super_admin() with consent-gated access.
--    Super admin can ONLY access tenant data when:
--      a) An active support access grant exists, OR
--      b) Operating on their own company
--
--    GDPR Art. 28 — Processor acts only on controller's instructions
-- ============================================================

-- Helper that combines membership check + support access check
CREATE OR REPLACE FUNCTION can_access_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN is_super_admin() THEN has_active_support_access(p_company_id)
      ELSE is_my_company(p_company_id)
    END;
$$;

-- Rebuild RLS on ALL tenant-scoped tables using consent-gated access
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    -- Original tables from migration 020/032
    'employees', 'expense_claims', 'expense_line_items',
    'leave_requests', 'leave_balances', 'leave_types',
    'onboarding', 'kudos', 'announcements', 'payslips',
    'workflow_tracker', 'notifications', 'app_settings',
    -- Tables from migration 035
    'benefit_types', 'benefit_options', 'benefit_enrollments',
    'shift_templates', 'shift_assignments', 'rotas',
    'shift_swap_requests', 'employee_availability',
    'legal_clients', 'legal_matters', 'legal_timesheet_entries',
    'company_elearning_courses', 'company_features', 'hr_tickets',
    -- Tables from migration 033
    'space_bookings',
    -- Tables from other migrations
    'timesheets', 'one_to_one_meetings', 'one_to_one_comments',
    'performance_reviews', 'customer_projects'
  ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped insert" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped update" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped delete" ON %I', tbl);

    -- GDPR-compliant: super_admin access requires active support grant
    EXECUTE format(
      'CREATE POLICY "Company scoped read" ON %I FOR SELECT
       USING (can_access_company(company_id))', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped insert" ON %I FOR INSERT
       WITH CHECK (can_access_company(company_id))', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped update" ON %I FOR UPDATE
       USING (can_access_company(company_id))', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped delete" ON %I FOR DELETE
       USING (can_access_company(company_id))', tbl);
  END LOOP;
END $$;

-- companies table: super admin always needs to see company list for the admin UI
DROP POLICY IF EXISTS "Company scoped read" ON companies;
CREATE POLICY "Company scoped read" ON companies FOR SELECT
  USING (is_my_company(id) OR is_super_admin());

-- company_users: super admin needs to manage user assignments
DROP POLICY IF EXISTS "Company scoped read" ON company_users;
DROP POLICY IF EXISTS "Company scoped insert" ON company_users;
DROP POLICY IF EXISTS "Company scoped update" ON company_users;
DROP POLICY IF EXISTS "Company scoped delete" ON company_users;

CREATE POLICY "Company scoped read" ON company_users FOR SELECT
  USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped insert" ON company_users FOR INSERT
  WITH CHECK (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped update" ON company_users FOR UPDATE
  USING (is_my_company(company_id) OR is_super_admin());
CREATE POLICY "Company scoped delete" ON company_users FOR DELETE
  USING (is_my_company(company_id) OR is_super_admin());


-- ============================================================
-- 6. DATA SUBJECT RIGHTS: PORTABLE EXPORT
--    GDPR Art. 20 — Right to data portability
--    Returns all personal data for an employee as structured JSON
-- ============================================================

CREATE OR REPLACE FUNCTION export_employee_data(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     jsonb;
  v_company_id uuid;
  v_emp        jsonb;
BEGIN
  -- Get company_id for access check
  SELECT company_id INTO v_company_id
    FROM employees WHERE id = p_employee_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Verify caller has access
  IF NOT (is_my_company(v_company_id) OR is_super_admin()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Core employee record
  SELECT to_jsonb(e) INTO v_emp
    FROM employees e WHERE e.id = p_employee_id;

  -- Build comprehensive portable export
  SELECT jsonb_build_object(
    'export_metadata', jsonb_build_object(
      'format',       'InflowHR GDPR Export v1',
      'exported_at',  now(),
      'employee_id',  p_employee_id,
      'gdpr_article', 'Art. 20 — Right to data portability'
    ),
    'employee',           v_emp,
    'leave_requests',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_requests     r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'leave_balances',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_balances     r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'expense_claims',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_claims     r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'expense_line_items', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_line_items r WHERE r.claim_id IN
                            (SELECT id FROM expense_claims WHERE employee_id = p_employee_id)), '[]'::jsonb),
    'payslips',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM payslips           r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'kudos_given',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM kudos              r WHERE r.given_by    = p_employee_id), '[]'::jsonb),
    'kudos_received',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM kudos              r WHERE r.given_to    = p_employee_id), '[]'::jsonb),
    'timesheets',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM timesheets          r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'benefit_enrollments',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_enrollments r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'shift_assignments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_assignments   r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'performance_reviews',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM performance_reviews r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'space_bookings',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM space_bookings      r WHERE r.booked_by   = p_employee_id), '[]'::jsonb),
    'legal_timesheet_entries', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_timesheet_entries r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'one_to_one_meetings',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_meetings r WHERE r.employee_id = p_employee_id
                            OR r.manager_id = p_employee_id), '[]'::jsonb),
    'hr_tickets',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM hr_tickets          r WHERE r.submitted_by = p_employee_id::text), '[]'::jsonb),
    'onboarding',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM onboarding          r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'notifications',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM notifications       r WHERE r.user_id     = p_employee_id), '[]'::jsonb)
  ) INTO v_result;

  -- Log the export action
  PERFORM log_gdpr_action(
    v_company_id, 'employees', p_employee_id::text, 'EXPORT',
    NULL, NULL, NULL,
    jsonb_build_object('type', 'data_portability', 'article', 'Art. 20')
  );

  RETURN v_result;
END;
$$;


-- ============================================================
-- 7. DATA SUBJECT RIGHTS: ANONYMISATION (SOFT DELETE)
--    GDPR Art. 17 — Right to erasure / Right to be forgotten
--
--    Strategy: replace PII with anonymised tokens while retaining
--    non-identifying aggregate records required by UK statutory
--    retention periods:
--      — HMRC tax records: 6 years (Finance Act 1998)
--      — Working time records: 2 years (Working Time Regs 1998)
--      — Payroll records: 6 years (Taxes Management Act 1970)
--      — Accident/injury records: 3 years (Limitation Act 1980)
--
--    The employee row is kept but all PII fields are scrubbed.
--    Financial/payroll records are retained with anonymised refs.
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS anonymised_by uuid;

CREATE OR REPLACE FUNCTION anonymise_employee(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_anon_token text;
  v_old_data   jsonb;
  v_result     jsonb;
BEGIN
  -- Get company for access check and old data for audit
  SELECT company_id INTO v_company_id
    FROM employees WHERE id = p_employee_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF NOT (is_my_company(v_company_id) OR is_super_admin()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Check if already anonymised
  IF EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id AND anonymised_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Employee already anonymised';
  END IF;

  -- Capture old data for audit trail
  SELECT to_jsonb(e) INTO v_old_data
    FROM employees e WHERE e.id = p_employee_id;

  -- Generate anonymisation token
  v_anon_token := 'ANON-' || substr(md5(p_employee_id::text || now()::text), 1, 8);

  -- Scrub all PII from employees table
  -- Retain: id, company_id, is_active, created_at, department, job_title (non-PII),
  --         annual_salary (retained for payroll records — 6yr HMRC retention)
  UPDATE employees SET
    first_name                   = v_anon_token,
    last_name                    = 'Redacted',
    email                        = v_anon_token || '@redacted.local',
    phone                        = NULL,
    personal_email               = NULL,
    date_of_birth                = NULL,
    gender                       = NULL,
    nationality                  = NULL,
    marital_status               = NULL,
    address_line1                = NULL,
    address_line2                = NULL,
    city                         = NULL,
    county                       = NULL,
    postcode                     = NULL,
    country                      = NULL,
    emergency_contact_name       = NULL,
    emergency_contact_phone      = NULL,
    emergency_contact_relationship = NULL,
    ni_number                    = NULL,
    bank_sort_code               = NULL,
    bank_account_number          = NULL,
    bank_account_name            = NULL,
    tax_code                     = NULL,
    payroll_id                   = NULL,
    manager_name                 = NULL,
    manager_email                = NULL,
    avatar_url                   = NULL,
    is_active                    = false,
    anonymised_at                = now(),
    anonymised_by                = auth.uid()
  WHERE id = p_employee_id;

  -- Scrub PII from onboarding records
  UPDATE onboarding SET
    first_name                   = v_anon_token,
    last_name                    = 'Redacted',
    email                        = v_anon_token || '@redacted.local',
    phone                        = NULL,
    personal_email               = NULL,
    date_of_birth                = NULL,
    gender                       = NULL,
    nationality                  = NULL,
    marital_status               = NULL,
    address_line1                = NULL,
    address_line2                = NULL,
    city                         = NULL,
    county                       = NULL,
    postcode                     = NULL,
    country                      = NULL,
    emergency_contact_name       = NULL,
    emergency_contact_phone      = NULL,
    emergency_contact_relationship = NULL,
    ni_number                    = NULL,
    bank_sort_code               = NULL,
    bank_account_number          = NULL,
    bank_account_name            = NULL,
    tax_code                     = NULL,
    payroll_id                   = NULL
  WHERE employee_id = p_employee_id;

  -- Delete non-retention records (no statutory requirement to keep)
  DELETE FROM kudos              WHERE given_by = p_employee_id OR given_to = p_employee_id;
  DELETE FROM notifications      WHERE user_id = p_employee_id;
  DELETE FROM one_to_one_comments WHERE meeting_id IN
    (SELECT id FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id);
  DELETE FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id;
  DELETE FROM space_bookings     WHERE booked_by = p_employee_id;
  DELETE FROM employee_availability WHERE employee_id = p_employee_id;

  -- Deactivate auth account linkage
  UPDATE company_users SET is_active = false
    WHERE employee_id = p_employee_id;

  -- Retained with anonymised employee reference (statutory retention):
  --   payslips, expense_claims, leave_requests, timesheets,
  --   legal_timesheet_entries, shift_assignments, performance_reviews,
  --   benefit_enrollments

  -- Log the anonymisation
  PERFORM log_gdpr_action(
    v_company_id, 'employees', p_employee_id::text, 'ANONYMISE',
    v_old_data, jsonb_build_object('anon_token', v_anon_token),
    NULL,
    jsonb_build_object(
      'type',     'right_to_erasure',
      'article',  'Art. 17',
      'retained', 'payslips, expense_claims, leave_requests, timesheets, legal_timesheets, shifts, performance_reviews, benefit_enrollments (statutory retention)'
    )
  );

  v_result := jsonb_build_object(
    'success',      true,
    'anon_token',   v_anon_token,
    'employee_id',  p_employee_id,
    'company_id',   v_company_id,
    'retained_tables', ARRAY[
      'payslips', 'expense_claims', 'leave_requests', 'timesheets',
      'legal_timesheet_entries', 'shift_assignments',
      'performance_reviews', 'benefit_enrollments'
    ]
  );

  RETURN v_result;
END;
$$;


-- ============================================================
-- 8. GRANT / REVOKE SUPPORT ACCESS FUNCTIONS
--    Wrappers that create audit log entries automatically
-- ============================================================

CREATE OR REPLACE FUNCTION grant_support_access(
  p_company_id  uuid,
  p_super_admin uuid,
  p_reason      text,
  p_scope       text DEFAULT 'read_only',
  p_hours       int  DEFAULT 24
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grant_id uuid;
BEGIN
  IF NOT is_my_company(p_company_id) THEN
    RAISE EXCEPTION 'Only company admins can grant support access';
  END IF;

  INSERT INTO tenant_support_access (
    company_id, granted_by, granted_to, reason, scope, expires_at
  ) VALUES (
    p_company_id, auth.uid(), p_super_admin, p_reason, p_scope,
    now() + (p_hours || ' hours')::interval
  )
  RETURNING id INTO v_grant_id;

  PERFORM log_gdpr_action(
    p_company_id, 'tenant_support_access', v_grant_id::text, 'GRANT_ACCESS',
    NULL,
    jsonb_build_object('granted_to', p_super_admin, 'reason', p_reason,
                       'scope', p_scope, 'expires_hours', p_hours),
    v_grant_id
  );

  RETURN v_grant_id;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_support_access(p_grant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id
    FROM tenant_support_access WHERE id = p_grant_id;

  IF NOT is_my_company(v_company_id) THEN
    RAISE EXCEPTION 'Only company admins can revoke support access';
  END IF;

  UPDATE tenant_support_access
    SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
  WHERE id = p_grant_id AND status = 'active';

  PERFORM log_gdpr_action(
    v_company_id, 'tenant_support_access', p_grant_id::text, 'REVOKE_ACCESS',
    NULL, jsonb_build_object('revoked_by', auth.uid())
  );
END;
$$;


-- ============================================================
-- 9. SCHEDULED CLEANUP: expire stale grants
--    Run via pg_cron or Supabase Edge Function cron
-- ============================================================

CREATE OR REPLACE FUNCTION expire_stale_support_grants()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE tenant_support_access
    SET status = 'expired'
  WHERE status = 'active'
    AND expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
