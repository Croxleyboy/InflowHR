-- CI-03: Prevent dual active check-ins at the database level.
-- Only one row with status = 'checked_in' may exist per employee per company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_one_active
  ON checkin_records (employee_id, company_id)
  WHERE status = 'checked_in';
