-- PAY-01: Migration 074 added CHECK (source IN ('inflowhr', 'xero')) to payslips.
-- Migration 108 (Sage) assumed no constraint existed. Drop the old one and replace
-- with a constraint that accepts all three sources.

ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_source_check;

ALTER TABLE payslips ADD CONSTRAINT payslips_source_check
  CHECK (source IN ('inflowhr', 'xero', 'sage'));
