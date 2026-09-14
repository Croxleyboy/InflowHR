-- ============================================================
-- 095 — Company Cancellation & Data Export
--
-- Implements the full cancellation lifecycle:
--   1. Company admin requests cancellation
--   2. High-priority ticket created for super admin
--   3. Super admin accepts → data frozen at billing period end
--   4. Login blocked for frozen companies
--   5. Automatic JSON export to storage
--   6. Super admin has 7 days to deliver export
--   7. After delivery, service responsibility ends
-- ============================================================


-- ============================================================
-- CANCELLATION STATUS ON COMPANIES
-- ============================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS cancellation_status TEXT
    CHECK (cancellation_status IS NULL OR cancellation_status IN (
      'pending', 'accepted', 'frozen', 'exported', 'completed', 'purged'
    ));


-- ============================================================
-- CANCELLATION REQUESTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS cancellation_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,

  -- Lifecycle status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'frozen', 'exported', 'completed', 'cancelled')),

  -- Billing: cancellation effective at end of current billing period
  billing_end_date DATE NOT NULL,

  -- Timestamps for each lifecycle stage
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id),
  data_frozen_at TIMESTAMPTZ,
  data_exported_at TIMESTAMPTZ,
  export_storage_path TEXT,
  export_sent_at TIMESTAMPTZ,

  -- After export is sent, data can be purged after this date
  purge_after DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(company_id, status)
);

CREATE INDEX IF NOT EXISTS idx_cancellation_requests_company
  ON cancellation_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_status
  ON cancellation_requests(status);

ALTER TABLE cancellation_requests ENABLE ROW LEVEL SECURITY;

-- Company admins can read their own company's cancellation requests
DROP POLICY IF EXISTS "Company admin read cancellation" ON cancellation_requests;
CREATE POLICY "Company admin read cancellation" ON cancellation_requests
  FOR SELECT USING (
    can_access_company(company_id)
    AND (is_company_admin() OR is_super_admin())
  );

-- Company admins can create cancellation requests for their own company
DROP POLICY IF EXISTS "Company admin create cancellation" ON cancellation_requests;
CREATE POLICY "Company admin create cancellation" ON cancellation_requests
  FOR INSERT WITH CHECK (
    is_my_company(company_id)
    AND is_company_admin()
  );

-- Only super admin can update (accept, freeze, export, complete)
DROP POLICY IF EXISTS "Super admin update cancellation" ON cancellation_requests;
CREATE POLICY "Super admin update cancellation" ON cancellation_requests
  FOR UPDATE USING (is_super_admin());


-- ============================================================
-- REQUEST CANCELLATION RPC
-- Called by company admin. Creates the request, calculates
-- billing end date, and raises a high-priority ticket.
-- ============================================================

CREATE OR REPLACE FUNCTION request_company_cancellation(
  p_company_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
  v_billing_end DATE;
  v_company_name TEXT;
  v_next_ref TEXT;
  v_actor UUID;
BEGIN
  v_actor := auth.uid();

  -- Must be a company admin for this company
  IF NOT (is_my_company(p_company_id) AND is_company_admin()) THEN
    RAISE EXCEPTION 'Only a company admin can request cancellation';
  END IF;

  -- Check no active cancellation already exists
  IF EXISTS (
    SELECT 1 FROM cancellation_requests
    WHERE company_id = p_company_id
      AND status NOT IN ('cancelled', 'completed')
  ) THEN
    RAISE EXCEPTION 'A cancellation request is already in progress for this company';
  END IF;

  -- Check company isn't already frozen/purged
  IF EXISTS (
    SELECT 1 FROM companies
    WHERE id = p_company_id
      AND cancellation_status IN ('frozen', 'exported', 'completed', 'purged')
  ) THEN
    RAISE EXCEPTION 'This company has already been cancelled';
  END IF;

  SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;

  -- Calculate billing end date: end of current calendar month
  v_billing_end := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;

  -- Create the cancellation request
  INSERT INTO cancellation_requests (
    company_id, requested_by, reason, billing_end_date
  ) VALUES (
    p_company_id, v_actor, p_reason, v_billing_end
  ) RETURNING id INTO v_request_id;

  -- Update company status
  UPDATE companies
    SET cancellation_status = 'pending',
        updated_at = now()
  WHERE id = p_company_id;

  -- Generate next HR ticket ref
  SELECT 'HR-' || LPAD((COALESCE(MAX(CAST(SUBSTRING(ref FROM 4) AS int)), 0) + 1)::text, 3, '0')
    INTO v_next_ref
    FROM hr_tickets;

  -- Create high-priority ticket for super admin
  INSERT INTO hr_tickets (
    ref, title, description, category, priority, status,
    submitted_by, company_id
  ) VALUES (
    v_next_ref,
    'CANCELLATION REQUEST — ' || v_company_name,
    'Company "' || v_company_name || '" has requested subscription cancellation.' ||
    E'\n\nReason: ' || COALESCE(p_reason, 'No reason provided') ||
    E'\n\nBilling period ends: ' || v_billing_end::text ||
    E'\n\nAction required: Review and accept the cancellation request in Admin > Cancellations.',
    'cancellation',
    'high',
    'open',
    v_actor::text,
    p_company_id
  );

  -- GDPR audit log
  PERFORM log_gdpr_action(
    v_actor, 'company_admin', p_company_id,
    NULL, 'cancellation_requests', v_request_id::text,
    'CANCELLATION_REQUESTED', NULL, NULL,
    jsonb_build_object(
      'reason', COALESCE(p_reason, 'none'),
      'billing_end_date', v_billing_end::text
    )
  );

  RETURN v_request_id;
END;
$$;


-- ============================================================
-- ACCEPT CANCELLATION RPC
-- Called by super admin. Marks the request as accepted.
-- ============================================================

CREATE OR REPLACE FUNCTION accept_company_cancellation(
  p_request_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_actor UUID;
BEGIN
  v_actor := auth.uid();

  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can accept cancellation requests';
  END IF;

  SELECT company_id INTO v_company_id
    FROM cancellation_requests
    WHERE id = p_request_id AND status = 'pending';

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Cancellation request not found or not in pending status';
  END IF;

  UPDATE cancellation_requests
    SET status = 'accepted',
        accepted_at = now(),
        accepted_by = v_actor,
        updated_at = now()
  WHERE id = p_request_id;

  UPDATE companies
    SET cancellation_status = 'accepted',
        updated_at = now()
  WHERE id = v_company_id;

  PERFORM log_gdpr_action(
    v_actor, 'super_admin', v_company_id,
    NULL, 'cancellation_requests', p_request_id::text,
    'CANCELLATION_ACCEPTED', NULL, NULL,
    jsonb_build_object('accepted_at', now()::text)
  );
END;
$$;


-- ============================================================
-- FREEZE COMPANY DATA RPC
-- Called by pg_cron or super admin after billing_end_date.
-- Blocks logins and marks data as frozen.
-- ============================================================

CREATE OR REPLACE FUNCTION freeze_cancelled_company(
  p_request_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_billing_end DATE;
  v_actor UUID;
BEGIN
  v_actor := auth.uid();

  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can freeze company data';
  END IF;

  SELECT company_id, billing_end_date
    INTO v_company_id, v_billing_end
    FROM cancellation_requests
    WHERE id = p_request_id AND status = 'accepted';

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Cancellation request not found or not in accepted status';
  END IF;

  -- Verify billing period has ended
  IF CURRENT_DATE < v_billing_end THEN
    RAISE EXCEPTION 'Cannot freeze before billing period ends on %', v_billing_end;
  END IF;

  -- Deactivate all company users (blocks login)
  UPDATE company_users
    SET is_active = false, updated_at = now()
  WHERE company_id = v_company_id AND is_active = true;

  -- Update cancellation request
  UPDATE cancellation_requests
    SET status = 'frozen',
        data_frozen_at = now(),
        purge_after = (CURRENT_DATE + interval '30 days')::date,
        updated_at = now()
  WHERE id = p_request_id;

  -- Update company status
  UPDATE companies
    SET cancellation_status = 'frozen',
        updated_at = now()
  WHERE id = v_company_id;

  PERFORM log_gdpr_action(
    v_actor, 'super_admin', v_company_id,
    NULL, 'cancellation_requests', p_request_id::text,
    'COMPANY_FROZEN', NULL, NULL,
    jsonb_build_object(
      'data_frozen_at', now()::text,
      'purge_after', (CURRENT_DATE + interval '30 days')::text,
      'users_deactivated', true
    )
  );
END;
$$;


-- ============================================================
-- EXPORT COMPANY DATA RPC
-- Exports ALL company data as JSON. Called by super admin
-- after freeze. Stores result in Supabase storage.
-- Returns the JSON directly (frontend uploads to storage).
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

  -- Company record
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

    -- Core company data
    'company',              v_company,
    'employees',            COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employees            r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'company_users',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_users        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- HR data
    'leave_types',          COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_types          r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'leave_requests',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_requests       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'leave_balances',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_balances       r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Payroll
    'payslips',             COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM payslips             r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Expenses
    'expense_claims',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_claims       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'expense_line_items',   COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_line_items   r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Timesheets
    'timesheets',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM timesheets           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Performance
    'performance_reviews',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM performance_reviews  r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'kudos',                COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM kudos                r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Benefits
    'benefits',             COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefits             r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_types',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_types        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_options',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_options      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_enrollments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_enrollments  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'employee_benefits',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_benefits    r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    -- Shifts & rotas
    'rotas',                COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM rotas                r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_templates',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_templates      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_assignments',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_assignments    r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_swap_requests',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_swap_requests  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'employee_availability',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_availability r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Legal
    'legal_clients',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_clients        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'legal_matters',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_matters        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'legal_timesheet_entries', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_timesheet_entries r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Tickets
    'hr_tickets',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM hr_tickets           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Meetings
    'one_to_one_meetings',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_meetings  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'one_to_one_comments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_comments  r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Onboarding
    'onboarding',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM onboarding           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Announcements & notifications
    'announcements',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM announcements        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'notifications',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM notifications        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Workflow
    'workflow_tracker',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM workflow_tracker     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Settings & features
    'app_settings',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM app_settings         r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'company_features',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_features     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- E-learning
    'company_elearning_courses', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_elearning_courses r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'courses',              COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM courses              r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'course_enrolments',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM course_enrolments    r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    -- Check-in records
    'checkin_records',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM checkin_records      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'break_records',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM break_records        r WHERE r.checkin_id IN (SELECT id FROM checkin_records WHERE company_id = p_company_id)), '[]'::jsonb),

    -- Space bookings
    'space_bookings',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM space_bookings       r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    -- Skills & certifications
    'employee_skills',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_skills      r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'employee_certifications', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_certifications r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'skill_evidence',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM skill_evidence       r WHERE r.employee_skill_id IN (SELECT id FROM employee_skills WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id))), '[]'::jsonb),
    'skill_validations',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM skill_validations    r WHERE r.employee_skill_id IN (SELECT id FROM employee_skills WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id))), '[]'::jsonb),

    -- Assets
    'company_assets',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_assets       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'asset_updates',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM asset_updates        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Employee consents
    'employee_consents',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_consents    r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Billing snapshots
    'billing_snapshots',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM billing_snapshots    r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- User settings
    'user_settings',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM user_settings        r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    -- GDPR audit trail (included for transparency)
    'gdpr_audit_logs',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM gdpr_audit_logs     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    -- Support access history
    'tenant_support_access', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM tenant_support_access r WHERE r.company_id = p_company_id), '[]'::jsonb)
  ) INTO v_result;

  -- Log the export
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
-- MARK EXPORT COMPLETE RPC
-- Called after frontend uploads export to storage.
-- ============================================================

CREATE OR REPLACE FUNCTION mark_cancellation_exported(
  p_request_id UUID,
  p_storage_path TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can mark export complete';
  END IF;

  SELECT company_id INTO v_company_id
    FROM cancellation_requests
    WHERE id = p_request_id AND status = 'frozen';

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or not in frozen status';
  END IF;

  UPDATE cancellation_requests
    SET status = 'exported',
        data_exported_at = now(),
        export_storage_path = p_storage_path,
        updated_at = now()
  WHERE id = p_request_id;

  UPDATE companies
    SET cancellation_status = 'exported',
        updated_at = now()
  WHERE id = v_company_id;

  PERFORM log_gdpr_action(
    auth.uid(), 'super_admin', v_company_id,
    NULL, 'cancellation_requests', p_request_id::text,
    'CANCELLATION_EXPORT_STORED', NULL, NULL,
    jsonb_build_object('storage_path', p_storage_path)
  );
END;
$$;


-- ============================================================
-- MARK DATA SENT TO CUSTOMER
-- Super admin confirms export was delivered. Sets 7-day
-- responsibility window then service is no longer liable.
-- ============================================================

CREATE OR REPLACE FUNCTION mark_cancellation_data_sent(
  p_request_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can mark data as sent';
  END IF;

  SELECT company_id INTO v_company_id
    FROM cancellation_requests
    WHERE id = p_request_id AND status = 'exported';

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Request not found or not in exported status';
  END IF;

  UPDATE cancellation_requests
    SET status = 'completed',
        export_sent_at = now(),
        updated_at = now()
  WHERE id = p_request_id;

  UPDATE companies
    SET cancellation_status = 'completed',
        updated_at = now()
  WHERE id = v_company_id;

  PERFORM log_gdpr_action(
    auth.uid(), 'super_admin', v_company_id,
    NULL, 'cancellation_requests', p_request_id::text,
    'CANCELLATION_DATA_SENT', NULL, NULL,
    jsonb_build_object(
      'sent_at', now()::text,
      'retention_obligation', 'transferred to customer (data controller)'
    )
  );
END;
$$;


-- ============================================================
-- AUTO-FREEZE CRON JOB
-- Runs daily. Freezes accepted cancellations whose billing
-- period has ended.
-- ============================================================

CREATE OR REPLACE FUNCTION auto_freeze_cancelled_companies()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
  v_frozen int := 0;
BEGIN
  FOR v_req IN
    SELECT cr.id, cr.company_id
    FROM cancellation_requests cr
    WHERE cr.status = 'accepted'
      AND cr.billing_end_date <= CURRENT_DATE
  LOOP
    -- Deactivate all company users
    UPDATE company_users
      SET is_active = false, updated_at = now()
    WHERE company_id = v_req.company_id AND is_active = true;

    -- Update request
    UPDATE cancellation_requests
      SET status = 'frozen',
          data_frozen_at = now(),
          purge_after = (CURRENT_DATE + interval '30 days')::date,
          updated_at = now()
    WHERE id = v_req.id;

    -- Update company
    UPDATE companies
      SET cancellation_status = 'frozen',
          updated_at = now()
    WHERE id = v_req.company_id;

    -- Audit log
    INSERT INTO gdpr_audit_logs (
      company_id, table_name, record_id,
      action, metadata
    ) VALUES (
      v_req.company_id, 'cancellation_requests', v_req.id::text,
      'COMPANY_AUTO_FROZEN',
      jsonb_build_object(
        'triggered_by', 'pg_cron auto_freeze',
        'purge_after', (CURRENT_DATE + interval '30 days')::text
      )
    );

    v_frozen := v_frozen + 1;
  END LOOP;

  RETURN v_frozen;
END;
$$;


-- ============================================================
-- AUTO-PURGE CRON JOB
-- Purges company data 30 days after freeze if export has been
-- sent (status = 'completed') and purge_after has passed.
-- ============================================================

CREATE OR REPLACE FUNCTION auto_purge_cancelled_companies()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
  v_purged int := 0;
BEGIN
  FOR v_req IN
    SELECT cr.id, cr.company_id
    FROM cancellation_requests cr
    WHERE cr.status = 'completed'
      AND cr.purge_after IS NOT NULL
      AND cr.purge_after <= CURRENT_DATE
  LOOP
    -- Use existing delete_company_data to wipe everything
    PERFORM delete_company_data(v_req.company_id);

    v_purged := v_purged + 1;
  END LOOP;

  RETURN v_purged;
END;
$$;


-- ============================================================
-- GET OUTSTANDING BILLING FOR CANCELLATION
-- Returns what the company owes for the remainder of the
-- current billing period (used by the cancellation UI).
-- ============================================================

CREATE OR REPLACE FUNCTION get_cancellation_billing_summary(p_company_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billing_type TEXT;
  v_result jsonb;
  v_monthly_total NUMERIC(10,2) := 0;
  v_fixed_price NUMERIC(10,2);
  v_employee_count INT;
  v_billing_end DATE;
BEGIN
  IF NOT (is_my_company(p_company_id) AND (is_company_admin() OR is_super_admin())) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT billing_type, fixed_annual_price
    INTO v_billing_type, v_fixed_price
    FROM companies WHERE id = p_company_id;

  -- End of current month
  v_billing_end := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;

  IF v_billing_type = 'fixed' AND v_fixed_price IS NOT NULL THEN
    v_result := jsonb_build_object(
      'billing_type', 'fixed',
      'billing_end_date', v_billing_end,
      'outstanding_amount', v_fixed_price,
      'note', 'Fixed annual subscription — full amount applies regardless of cancellation date'
    );
  ELSE
    -- Monthly billing: calculate current month cost
    SELECT COUNT(*) INTO v_employee_count
      FROM employees WHERE company_id = p_company_id AND is_active = true;

    -- Sum subscription pricing for active features
    SELECT COALESCE(SUM(sp.default_price), 0) INTO v_monthly_total
      FROM company_features cf
      JOIN subscription_pricing sp ON sp.feature_key = cf.feature_key
      WHERE cf.company_id = p_company_id AND cf.is_enabled = true AND sp.is_active = true;

    v_monthly_total := v_monthly_total * v_employee_count;

    v_result := jsonb_build_object(
      'billing_type', 'monthly',
      'billing_end_date', v_billing_end,
      'employee_count', v_employee_count,
      'per_employee_monthly', v_monthly_total / GREATEST(v_employee_count, 1),
      'outstanding_amount', v_monthly_total,
      'note', 'Cancellation mid-month still incurs the full month charge for all active subscriptions'
    );
  END IF;

  RETURN v_result;
END;
$$;


-- ============================================================
-- SCHEDULE CRON JOBS (if pg_cron available)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Auto-freeze accepted cancellations at midnight
    PERFORM cron.schedule(
      'auto-freeze-cancelled-companies',
      '0 0 * * *',
      'SELECT auto_freeze_cancelled_companies()'
    );

    -- Auto-purge completed cancellations at 04:00
    PERFORM cron.schedule(
      'auto-purge-cancelled-companies',
      '0 4 * * *',
      'SELECT auto_purge_cancelled_companies()'
    );
  END IF;
END $$;


-- ============================================================
-- PERMISSIONS
-- ============================================================

REVOKE EXECUTE ON FUNCTION request_company_cancellation(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION request_company_cancellation(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION accept_company_cancellation(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION accept_company_cancellation(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION freeze_cancelled_company(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION freeze_cancelled_company(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION export_company_data(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION export_company_data(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION mark_cancellation_exported(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION mark_cancellation_exported(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION mark_cancellation_data_sent(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION mark_cancellation_data_sent(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_cancellation_billing_summary(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_cancellation_billing_summary(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION auto_freeze_cancelled_companies() FROM anon;
REVOKE EXECUTE ON FUNCTION auto_purge_cancelled_companies() FROM anon;
