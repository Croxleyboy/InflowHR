-- Restructure subscription_pricing into Core / Pack A / Pack B + support packages

-- Add pack grouping column and support package fields
ALTER TABLE subscription_pricing
  ADD COLUMN IF NOT EXISTS pack TEXT,
  ADD COLUMN IF NOT EXISTS is_support_package BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flat_price NUMERIC(10,2);

-- Assign packs to existing rows
UPDATE subscription_pricing SET pack = 'core' WHERE feature_key = 'hr_core';
UPDATE subscription_pricing SET pack = 'core', is_addon = false WHERE feature_key IN ('benefits', 'email_notifications', 'xero_integration', 'sage_integration');

UPDATE subscription_pricing SET pack = 'pack_a' WHERE feature_key IN ('shifts', 'legal_timesheets', 'space_booking', 'asset_management');
UPDATE subscription_pricing SET pack = 'pack_b' WHERE feature_key IN ('teams_integration', 'skills_passport');

-- Insert pack-level pricing rows (one price per pack)
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, pack)
VALUES ('pack_a', 'Workforce & Operations', 'Shifts & Rotas, Legal Timesheets, Space & Desk Booking, Asset Management', 2.00, true, true, 'pack_a')
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, pack)
VALUES ('pack_b', 'Enterprise Integrations', 'Teams & Presence, Skills Passport & Talent Intelligence', 1.50, true, true, 'pack_b')
ON CONFLICT (feature_key) DO NOTHING;

-- Insert support packages (flat fee, not per-user)
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, is_support_package, flat_price)
VALUES ('support_onboarding', '1-Day Onboarding', 'Guided onboarding session to get your team set up', 0, false, true, true, 350.00)
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, is_support_package, flat_price)
VALUES ('support_technical', '5-Day Technical Support', 'Extended technical support package for complex setup and migration', 0, false, true, true, 1500.00)
ON CONFLICT (feature_key) DO NOTHING;

-- Update core features display list in hr_core description
UPDATE subscription_pricing
SET description = 'Leave, Performance, E-Learning, Expenses, Onboarding/Offboarding, Payroll/Xero/Sage, Kudos, Announcements & Notifications, Benefits, GDPR Document Storage, Timesheets, HR Tickets, Email Notifications'
WHERE feature_key = 'hr_core';
