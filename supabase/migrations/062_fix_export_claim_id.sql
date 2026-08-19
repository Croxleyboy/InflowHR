-- Fix export_employee_data: column is expense_claim_id not claim_id
CREATE OR REPLACE FUNCTION export_employee_data(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_emp   jsonb;
  v_result jsonb;
BEGIN
  SELECT to_jsonb(e) INTO v_emp
  FROM employees e
  WHERE e.id = p_employee_id;

  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

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

  PERFORM log_gdpr_action(p_employee_id, 'data_export', 'Employee data exported via GDPR Art. 20');

  RETURN v_result;
END;
$$;
