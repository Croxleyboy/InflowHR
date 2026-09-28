-- CI-02: Notify employees and managers when a scheduled shift check-in is missed.
-- Runs every 30 minutes via pg_cron. Finds published-rota shifts that started
-- more than 30 minutes ago with no matching checkin_record, and inserts a
-- workflow_tracker notification (deduped by key).

CREATE OR REPLACE FUNCTION notify_missed_shift_checkins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record record;
  v_count integer := 0;
  v_key text;
BEGIN
  IF NOT (is_super_admin() OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'Only super admin or postgres can call this function';
  END IF;

  FOR v_record IN
    SELECT sa.id AS assignment_id,
           sa.employee_id,
           sa.company_id,
           sa.date,
           st.name AS shift_name,
           st.start_time,
           st.end_time,
           e.first_name,
           e.last_name,
           e.email,
           e.manager_id
    FROM shift_assignments sa
    JOIN rotas r ON r.id = sa.rota_id AND r.status = 'published'
    JOIN shift_templates st ON st.id = sa.shift_template_id
    JOIN employees e ON e.id = sa.employee_id AND e.is_active = true
    JOIN checkin_settings cs ON cs.company_id = sa.company_id AND cs.shift_checkin_enabled = true
    WHERE sa.date = CURRENT_DATE
      AND (CURRENT_DATE + st.start_time) < (now() - interval '30 minutes')
      AND NOT EXISTS (
        SELECT 1 FROM checkin_records cr
        WHERE cr.employee_id = sa.employee_id
          AND cr.company_id = sa.company_id
          AND cr.shift_assignment_id = sa.id
      )
  LOOP
    v_key := 'missed-checkin-' || v_record.assignment_id;

    IF NOT EXISTS (
      SELECT 1 FROM workflow_tracker
      WHERE company_id = v_record.company_id
        AND record_type = 'Missed Check-In'
        AND extra_info::text LIKE '%' || v_key || '%'
    ) THEN
      INSERT INTO workflow_tracker (
        emp_display_name, step, status, record_type, action,
        employee_email, assigned_to, approval_id, reminder_count,
        task_description, approval_status, extra_info, company_id
      ) VALUES (
        v_record.first_name || ' ' || v_record.last_name,
        1, 'Pending', 'Missed Check-In', 'Missed shift check-in',
        v_record.email, v_record.email,
        v_record.assignment_id, 1,
        v_record.first_name || ' ' || v_record.last_name
          || ' missed check-in for ' || v_record.shift_name
          || ' (' || to_char(v_record.start_time, 'HH24:MI') || '-'
          || to_char(v_record.end_time, 'HH24:MI') || ') on '
          || to_char(v_record.date, 'DD/MM/YYYY') || '.',
        'Pending',
        jsonb_build_object('key', v_key),
        v_record.company_id
      );

      -- Also notify the employee's manager if they have one
      IF v_record.manager_id IS NOT NULL THEN
        DECLARE
          v_mgr_email text;
        BEGIN
          SELECT email INTO v_mgr_email FROM employees
          WHERE id = v_record.manager_id AND is_active = true;

          IF v_mgr_email IS NOT NULL THEN
            INSERT INTO workflow_tracker (
              emp_display_name, step, status, record_type, action,
              employee_email, assigned_to, approval_id, reminder_count,
              task_description, approval_status, extra_info, company_id
            ) VALUES (
              v_record.first_name || ' ' || v_record.last_name,
              1, 'Pending', 'Missed Check-In', 'Missed shift check-in',
              v_mgr_email, v_mgr_email,
              v_record.assignment_id, 1,
              v_record.first_name || ' ' || v_record.last_name
                || ' missed check-in for ' || v_record.shift_name
                || ' (' || to_char(v_record.start_time, 'HH24:MI') || '-'
                || to_char(v_record.end_time, 'HH24:MI') || ') on '
                || to_char(v_record.date, 'DD/MM/YYYY') || '.',
              'Pending',
              jsonb_build_object('key', v_key || '-mgr'),
              v_record.company_id
            );
          END IF;
        END;
      END IF;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION notify_missed_shift_checkins() FROM anon;
GRANT EXECUTE ON FUNCTION notify_missed_shift_checkins() TO authenticated;

-- Schedule every 30 minutes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-missed-checkins') THEN
      PERFORM cron.unschedule('notify-missed-checkins');
    END IF;
    PERFORM cron.schedule(
      'notify-missed-checkins',
      '*/30 * * * *',
      'SELECT notify_missed_shift_checkins()'
    );
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;
