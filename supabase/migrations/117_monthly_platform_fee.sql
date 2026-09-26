-- Add a monthly platform fee column to companies (flat charge per company, not per user)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS monthly_platform_fee NUMERIC(10,2) NOT NULL DEFAULT 30.00;

-- Also add monthly_platform_fee to billing_snapshots for historical accuracy
ALTER TABLE billing_snapshots
  ADD COLUMN IF NOT EXISTS monthly_platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
