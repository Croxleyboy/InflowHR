-- Add fixed-price billing support to companies
-- billing_type: 'monthly' (default, per-user pricing) or 'fixed' (annual fixed price)
-- fixed_annual_price: the agreed annual price when billing_type = 'fixed'
-- billing_type_locked_until: date until which billing_type cannot be reverted (start of next FY)

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_type IN ('monthly', 'fixed')),
  ADD COLUMN IF NOT EXISTS fixed_annual_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS billing_type_locked_until DATE;
