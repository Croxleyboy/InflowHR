-- Finding #18: Make audit log tables append-only (or admin-update-only)
-- CWE-863: Incorrect Authorization
--
-- holiday_accrual_log: remove UPDATE policy entirely (no app code updates these rows)
-- shift_cancellation_log: restrict UPDATE to admin/HR only (payroll wizard marks compensation_included_in_payrun)
--                         restrict DELETE to super_admin only (was any company member)

-- ============================================================
-- 1. holiday_accrual_log — make fully append-only
-- ============================================================
DROP POLICY IF EXISTS "holiday_accrual_log_update" ON holiday_accrual_log;

REVOKE UPDATE ON holiday_accrual_log FROM authenticated;
REVOKE UPDATE ON holiday_accrual_log FROM anon;

-- ============================================================
-- 2. shift_cancellation_log — restrict UPDATE to admin/HR, DELETE to super_admin
-- ============================================================
DROP POLICY IF EXISTS "scl_update" ON shift_cancellation_log;
DROP POLICY IF EXISTS "scl_delete" ON shift_cancellation_log;

CREATE POLICY "scl_update" ON shift_cancellation_log
  FOR UPDATE USING (is_company_admin() OR is_super_admin());

CREATE POLICY "scl_delete" ON shift_cancellation_log
  FOR DELETE USING (is_super_admin());
