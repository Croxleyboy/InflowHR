-- Migration 075: Add payslip_source preference to xero_integrations
-- Controls whether company employees see InflowHR or Xero payslips.

ALTER TABLE xero_integrations
  ADD COLUMN IF NOT EXISTS payslip_source text NOT NULL DEFAULT 'inflowhr'
  CHECK (payslip_source IN ('inflowhr', 'xero'));
