-- CR-09: Add role guard to export_employee_data and anonymise_employee
-- Previously any employee in the same company could export a colleague's
-- PII or anonymise their record by calling the RPC directly.
--
-- export_employee_data: allow self-service (own data, GDPR Art. 20)
--   OR admin/HR for exporting someone else's data
-- anonymise_employee: admin/HR only — no employee should anonymise anyone


-- ── export_employee_data ─────────────────────────────────────────────────
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
  v_caller_employee_id uuid;
BEGIN
  SELECT company_id INTO v_company_id
    FROM employees WHERE id = p_employee_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF NOT (is_my_company(v_company_id) OR is_super_admin()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- CR-09: check if caller is exporting their own data (self-service GDPR)
  SELECT employee_id INTO v_caller_employee_id
    FROM company_users
    WHERE auth_user_id = auth.uid()
      AND company_id = v_company_id
      AND is_active = true
    LIMIT 1;

  IF v_caller_employee_id IS DISTINCT FROM p_employee_id
     AND NOT is_company_admin()
     AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: admin or HR role required to export another employee''s data';
  END IF;

  SELECT to_jsonb(e) INTO v_emp
    FROM employees e WHERE e.id = p_employee_id;

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
    'expense_line_items', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_line_items r WHERE r.expense_claim_id IN
                            (SELECT id FROM expense_claims WHERE employee_id = p_employee_id)), '[]'::jsonb),
    'payslips',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM payslips           r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'kudos_given',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM kudos              r WHERE r.from_employee_id = p_employee_id), '[]'::jsonb),
    'kudos_received',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM kudos              r WHERE r.to_employee_id   = p_employee_id), '[]'::jsonb),
    'timesheets',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM timesheets          r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'benefit_enrollments',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_enrollments r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'shift_assignments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_assignments   r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'performance_reviews',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM performance_reviews r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'space_bookings',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM space_bookings      r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'legal_timesheet_entries', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_timesheet_entries r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'one_to_one_meetings',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_meetings r WHERE r.employee_id = p_employee_id
                            OR r.manager_id = p_employee_id), '[]'::jsonb),
    'hr_tickets',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM hr_tickets          r WHERE r.submitted_by = p_employee_id::text), '[]'::jsonb),
    'onboarding',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM onboarding          r WHERE r.employee_id = p_employee_id), '[]'::jsonb),
    'notifications',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM notifications       r WHERE r.employee_id = p_employee_id), '[]'::jsonb)
  ) INTO v_result;

  PERFORM log_gdpr_action(
    v_company_id, 'employees', p_employee_id::text, 'EXPORT',
    NULL, NULL, NULL,
    jsonb_build_object('type', 'data_portability', 'article', 'Art. 20')
  );

  RETURN v_result;
END;
$$;


-- ── anonymise_employee ───────────────────────────────────────────────────
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
  SELECT company_id INTO v_company_id
    FROM employees WHERE id = p_employee_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF NOT (is_my_company(v_company_id) OR is_super_admin()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- CR-09: require admin/HR role — no employee should anonymise anyone
  IF NOT is_company_admin() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: admin or HR role required';
  END IF;

  IF EXISTS (SELECT 1 FROM employees WHERE id = p_employee_id AND anonymised_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Employee already anonymised';
  END IF;

  SELECT to_jsonb(e) INTO v_old_data
    FROM employees e WHERE e.id = p_employee_id;

  v_anon_token := 'ANON-' || substr(md5(p_employee_id::text || now()::text), 1, 8);

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

  DELETE FROM kudos              WHERE from_employee_id = p_employee_id OR to_employee_id = p_employee_id;
  DELETE FROM notifications      WHERE employee_id = p_employee_id;
  DELETE FROM one_to_one_comments WHERE meeting_id IN
    (SELECT id FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id);
  DELETE FROM one_to_one_meetings WHERE employee_id = p_employee_id OR manager_id = p_employee_id;
  DELETE FROM space_bookings     WHERE employee_id = p_employee_id;
  DELETE FROM employee_availability WHERE employee_id = p_employee_id;

  UPDATE company_users SET is_active = false
    WHERE employee_id = p_employee_id;

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
