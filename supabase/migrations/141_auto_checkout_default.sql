-- Reduce auto-checkout default from 10 hours to 2 hours
-- so forgotten checkouts are flagged sooner
ALTER TABLE checkin_settings ALTER COLUMN auto_checkout_hours SET DEFAULT 2;

-- Update the auto-close cron function to use 2h fallback instead of 10h
CREATE OR REPLACE FUNCTION auto_close_stale_checkins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_record record;
BEGIN
  IF NOT (is_super_admin() OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'Only super admin or pg_cron can call this function';
  END IF;

  FOR v_record IN
    SELECT cr.id, cr.company_id, cr.employee_id, cr.check_in_at,
           COALESCE(cs.auto_checkout_hours, 2) AS max_hours
    FROM checkin_records cr
    LEFT JOIN checkin_settings cs ON cs.company_id = cr.company_id
    WHERE cr.status = 'checked_in'
      AND cr.check_in_at < now() - (COALESCE(cs.auto_checkout_hours, 2) || ' hours')::interval
  LOOP
    UPDATE checkin_records
    SET status = 'auto_closed',
        check_out_at = v_record.check_in_at + (v_record.max_hours || ' hours')::interval,
        updated_at = now()
    WHERE id = v_record.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION auto_close_stale_checkins() FROM anon;
GRANT EXECUTE ON FUNCTION auto_close_stale_checkins() TO authenticated;
