-- Bank Holidays
-- Per-company bank holiday dates, replaces hardcoded UK_BANK_HOLIDAYS list.
-- Admins manage via the Leave > Bank Holidays tab.
-- Shown on employee leave calendar; does NOT block leave bookings.

CREATE TABLE IF NOT EXISTS bank_holidays (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_holidays_company_date
  ON bank_holidays(company_id, holiday_date);

CREATE INDEX IF NOT EXISTS idx_bank_holidays_company
  ON bank_holidays(company_id);

ALTER TABLE bank_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_holidays_read"
  ON bank_holidays FOR SELECT
  USING (company_id = get_my_company_id());

CREATE POLICY "bank_holidays_admin_insert"
  ON bank_holidays FOR INSERT
  WITH CHECK (company_id = get_my_company_id() AND (is_company_admin() OR is_super_admin()));

CREATE POLICY "bank_holidays_admin_update"
  ON bank_holidays FOR UPDATE
  USING (company_id = get_my_company_id() AND (is_company_admin() OR is_super_admin()))
  WITH CHECK (company_id = get_my_company_id() AND (is_company_admin() OR is_super_admin()));

CREATE POLICY "bank_holidays_admin_delete"
  ON bank_holidays FOR DELETE
  USING (company_id = get_my_company_id() AND (is_company_admin() OR is_super_admin()));
