-- Migration 076: Cache Xero payslip data for persistent admin display
ALTER TABLE xero_integrations
  ADD COLUMN IF NOT EXISTS cached_pay_run jsonb,
  ADD COLUMN IF NOT EXISTS cached_payslips jsonb DEFAULT '[]'::jsonb;
