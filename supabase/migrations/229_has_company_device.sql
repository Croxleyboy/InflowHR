-- Add has_company_device flag to employees table
-- When false (default), persona changes are blocked in the UI
-- since personas only apply to employees with managed Entra ID devices

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS has_company_device BOOLEAN NOT NULL DEFAULT false;

-- Rollback:
--   ALTER TABLE employees DROP COLUMN IF EXISTS has_company_device;
