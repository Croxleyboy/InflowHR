-- When auto-closing a stale check-in linked to a shift assignment,
-- use the scheduled shift end time instead of check_in + max_hours.
-- This ensures auto-closed records reflect the actual scheduled hours
-- so payroll calculates the correct amount.

CREATE OR REPLACE FUNCTION auto_close_stale_checkins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_record record;
  v_checkout timestamptz;
BEGIN
  IF NOT (is_super_admin() OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'Only super admin or pg_cron can call this function';
  END IF;

  FOR v_record IN
    SELECT cr.id, cr.company_id, cr.employee_id, cr.check_in_at,
           cr.shift_assignment_id,
           sa.date AS shift_date,
           st.end_time AS scheduled_end,
           COALESCE(cs.auto_checkout_hours, 2) AS max_hours
    FROM checkin_records cr
    LEFT JOIN checkin_settings cs ON cs.company_id = cr.company_id
    LEFT JOIN shift_assignments sa ON sa.id = cr.shift_assignment_id
    LEFT JOIN shift_templates st ON st.id = sa.shift_template_id
    WHERE cr.status = 'checked_in'
      AND cr.check_in_at < now() - (COALESCE(cs.auto_checkout_hours, 2) || ' hours')::interval
  LOOP
    -- If linked to a shift, use the scheduled end time; otherwise fall back to check_in + max_hours
    IF v_record.shift_date IS NOT NULL AND v_record.scheduled_end IS NOT NULL THEN
      v_checkout := (v_record.shift_date || 'T' || v_record.scheduled_end)::timestamptz;
      -- Handle overnight shifts where end_time < start_time
      IF v_checkout <= v_record.check_in_at THEN
        v_checkout := v_checkout + interval '1 day';
      END IF;
    ELSE
      v_checkout := v_record.check_in_at + (v_record.max_hours || ' hours')::interval;
    END IF;

    UPDATE checkin_records
    SET status = 'auto_closed',
        check_out_at = v_checkout,
        updated_at = now()
    WHERE id = v_record.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION auto_close_stale_checkins() FROM anon;
GRANT EXECUTE ON FUNCTION auto_close_stale_checkins() TO authenticated;
