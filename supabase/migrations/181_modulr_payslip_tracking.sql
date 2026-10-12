-- 181: Add payslip_id to modulr_payment_items for per-payslip tracking
-- Needed so weekly-paid workers (shift/zero hours) can have multiple
-- Modulr payments per month without false duplicate detection.

ALTER TABLE modulr_payment_items
  ADD COLUMN IF NOT EXISTS payslip_id BIGINT REFERENCES payslips(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_modulr_payment_items_payslip
  ON modulr_payment_items (payslip_id)
  WHERE payslip_id IS NOT NULL;
