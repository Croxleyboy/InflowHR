-- 178_payslip_cancellation_compensation.sql
-- Add cancellation_compensation column to payslips for zero hours shift cancellation payouts.

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS cancellation_compensation NUMERIC(10,2) DEFAULT 0;
