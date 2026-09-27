-- LV-04: Atomic leave balance increment to prevent race conditions.
-- Replaces client-side read-then-write pattern with a single atomic UPDATE.

CREATE OR REPLACE FUNCTION adjust_leave_balance(
  p_employee_id UUID,
  p_year INT,
  p_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE leave_balances
  SET used = GREATEST(0, used + p_delta)
  WHERE employee_id = p_employee_id
    AND year = p_year;
END;
$$;

REVOKE ALL ON FUNCTION adjust_leave_balance(UUID, INT, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION adjust_leave_balance(UUID, INT, NUMERIC) TO authenticated;
