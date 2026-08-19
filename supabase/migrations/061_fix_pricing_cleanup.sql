-- Remove any stale "baseline subscription" row that isn't hr_core
-- The Pricing tab should only show one non-addon card: HR Core Platform
DELETE FROM subscription_pricing
WHERE is_addon = false
  AND feature_key != 'hr_core';

-- Update HR Core Platform default price to £2.50
UPDATE subscription_pricing
SET default_price = 2.50
WHERE feature_key = 'hr_core';

-- Add Asset Management as an add-on
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
SELECT 'asset_management', 'Asset Management', 'Company asset tracking and assignment', 1.00, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_pricing WHERE feature_key = 'asset_management'
);
