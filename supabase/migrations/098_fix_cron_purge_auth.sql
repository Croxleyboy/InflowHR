-- ============================================================
-- 098: Fix purge_expired_frozen_employees for pg_cron
-- pg_cron runs as postgres with no auth.uid(), so
-- is_super_admin() fails. Allow postgres role to bypass.
-- Also removes duplicate cron job and reschedules to 00:00 UTC.
-- ============================================================

CREATE OR REPLACE FUNCTION purge_expired_frozen_employees()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record record;
  v_count integer := 0;
BEGIN
  IF NOT (is_super_admin() OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'Only super admin can call this function';
  END IF;

  FOR v_record IN
    SELECT id, employee_id, company_id, employee_name
    FROM frozen_employees
    WHERE deletion_date <= now()
  LOOP
    PERFORM log_gdpr_action(
      v_record.company_id, 'frozen_employees', v_record.id::text, 'AUTO_PURGE',
      NULL, NULL, NULL,
      jsonb_build_object('employee_name', v_record.employee_name, 'reason', 'Retention period expired')
    );

    DELETE FROM frozen_employees WHERE id = v_record.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Remove duplicate cron job and reschedule to 00:00 UTC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-expired-frozen-employees-daily');
    PERFORM cron.unschedule('purge-frozen-employees');
    PERFORM cron.schedule(
      'purge-frozen-employees',
      '0 0 * * *',
      'SELECT purge_expired_frozen_employees()'
    );
  END IF;
END $$;
