-- CR-07: Fix anonymise_employee column names
-- The function referenced columns that don't exist:
--   kudos.given_by / given_to  →  from_employee_id / to_employee_id
--   notifications.user_id     →  employee_id
--   space_bookings.booked_by  →  employee_id

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
