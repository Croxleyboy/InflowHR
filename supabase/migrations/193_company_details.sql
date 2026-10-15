-- Migration 193: Add extra company detail columns for the Company Details page
-- company_registration_number, vat_number, and billing_address fields already exist from migration 149

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS office_phone text,
  ADD COLUMN IF NOT EXISTS staff_count integer;
