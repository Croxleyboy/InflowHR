-- Seed the baseline/core subscription pricing row
-- This represents the core HR platform price that every company pays per user
-- is_addon = false distinguishes it from add-on features
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
SELECT 'hr_core', 'HR Core Platform', 'Core HR platform including employee management, onboarding, payslips, and leave', 5.00, false, true
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_pricing WHERE is_addon = false
);
