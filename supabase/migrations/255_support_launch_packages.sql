-- Restructure support packages into Launch Packages (one-off) and Monthly Support Plans

-- Add column to distinguish launch packages from monthly support plans
ALTER TABLE subscription_pricing
  ADD COLUMN IF NOT EXISTS support_type TEXT DEFAULT NULL
    CHECK (support_type IS NULL OR support_type IN ('launch','monthly'));

-- Mark existing support packages for removal (they'll be replaced)
UPDATE subscription_pricing SET is_active = false WHERE feature_key IN ('support_onboarding', 'support_technical');

-- Insert 3 launch packages (one-off)
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, is_support_package, flat_price, support_type)
VALUES ('launch_essentials', 'Launch Essentials', 'Guided setup call, leave/onboarding/payroll configured, staff import, admin training (remote, recorded), go-live check + 30-day follow-up', 0, false, true, true, 995.00, 'launch')
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  flat_price = EXCLUDED.flat_price,
  is_support_package = true,
  is_active = true,
  support_type = 'launch';

INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, is_support_package, flat_price, support_type)
VALUES ('launch_managed', 'Managed Launch', 'Everything in Essentials, InflowOnboarder for Microsoft 365, Persona Packs from your role structure, Xero or Sage integration mapped and tested, two training sessions + staff walkthrough, 60-day support with a named contact', 0, false, true, true, 2495.00, 'launch')
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  flat_price = EXCLUDED.flat_price,
  is_support_package = true,
  is_active = true,
  support_type = 'launch';

INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, is_support_package, flat_price, support_type)
VALUES ('launch_premium', 'Premium Launch', 'Everything in Managed Launch, data migration from your current system, custom onboarding/offboarding workflows, multi-site Persona Pack configuration, parallel run alongside existing system, 90-day priority support', 0, false, true, true, 4995.00, 'launch')
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  flat_price = EXCLUDED.flat_price,
  is_support_package = true,
  is_active = true,
  support_type = 'launch';

-- Insert 2 monthly support plans
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, is_support_package, flat_price, support_type)
VALUES ('support_standard', 'Standard Support', 'User and admin guides, in-app AI Help Agent aligned with your company handbook, email and in-app tickets, up to 5 how-to tickets a month, every fix/security update/statutory rate change included, reports of faults never count towards your allowance', 0, false, true, true, 0, 'monthly')
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  flat_price = 0,
  is_support_package = true,
  is_active = true,
  support_type = 'monthly';

INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, is_support_package, flat_price, support_type)
VALUES ('support_plus', 'Plus Support', 'Everything in Standard, faster replies with critical issues handled first, booked phone or Teams calls with our team, up to 20 tickets a month, 3 named admins who can contact support, one admin training session a year', 0, false, true, true, 79.00, 'monthly')
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  flat_price = 79.00,
  is_support_package = true,
  is_active = true,
  support_type = 'monthly';
