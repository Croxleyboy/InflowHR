-- LV-06: Automated leave carry-over at FY rollover
-- Runs daily via pg_cron. For each company whose FY starts today,
-- creates new-year leave_balances rows with carried_over =
-- MIN(unused_days, max_carry_over_days) per leave type.

CREATE OR REPLACE FUNCTION execute_leave_carry_over()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company record;
  v_bal record;
  v_unused numeric;
  v_carry integer;
  v_new_year integer;
  v_count integer := 0;
BEGIN
  IF NOT (is_super_admin() OR current_user = 'postgres') THEN
    RAISE EXCEPTION 'Only super admin or postgres can call this function';
  END IF;

  FOR v_company IN
    SELECT id, fy_start_month
    FROM companies
    WHERE is_active = true
      AND EXTRACT(MONTH FROM CURRENT_DATE) = fy_start_month
      AND EXTRACT(DAY FROM CURRENT_DATE) = 1
  LOOP
    -- The new FY year is the calendar year of today
    v_new_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;

    FOR v_bal IN
      SELECT lb.employee_id, lb.leave_type_id, lb.total_allowance,
             lb.used, lb.carried_over, lb.lieu_days,
             lt.max_carry_over_days, lt.default_allowance
      FROM leave_balances lb
      JOIN leave_types lt ON lt.id = lb.leave_type_id AND lt.company_id = v_company.id
      JOIN employees e ON e.id = lb.employee_id AND e.company_id = v_company.id
      WHERE lb.company_id = v_company.id
        AND lb.year = v_new_year - 1
        AND lt.deducts_from_allowance = true
        AND lt.max_carry_over_days > 0
        AND e.is_active = true
    LOOP
      v_unused := GREATEST(0,
        v_bal.total_allowance + COALESCE(v_bal.carried_over, 0)
        + COALESCE(v_bal.lieu_days, 0) - v_bal.used
      );
      v_carry := LEAST(v_unused, v_bal.max_carry_over_days)::integer;

      IF v_carry > 0 THEN
        INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over, company_id)
        VALUES (
          v_bal.employee_id, v_bal.leave_type_id, v_new_year,
          v_bal.total_allowance, 0, v_carry, v_company.id
        )
        ON CONFLICT (employee_id, leave_type_id, year)
        DO UPDATE SET carried_over = EXCLUDED.carried_over
        WHERE leave_balances.carried_over = 0;

        v_count := v_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION execute_leave_carry_over() FROM anon;
GRANT EXECUTE ON FUNCTION execute_leave_carry_over() TO authenticated;

-- Schedule daily at 00:30 UTC (after purge job at 00:00)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('leave-carry-over-daily');
    PERFORM cron.schedule(
      'leave-carry-over-daily',
      '30 0 1 * *',
      'SELECT execute_leave_carry_over()'
    );
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;
