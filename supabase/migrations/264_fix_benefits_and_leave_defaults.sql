-- Fix 1: Enable benefits for all companies that have it disabled
-- Benefits is a STANDARD_FEATURE (core) but CompanySetupWizard was seeding it as false
UPDATE company_features
SET is_enabled = true
WHERE feature_key = 'benefits' AND is_enabled = false;

-- Fix 2: Update default_allowance on leave_types to UK-realistic values
-- The schema default is 25 which was applied to all types including event-based ones
UPDATE leave_types SET default_allowance = 25
WHERE LOWER(name) = 'annual leave' AND default_allowance = 25;

UPDATE leave_types SET default_allowance = 10
WHERE LOWER(name) = 'sick leave' AND default_allowance = 25;

UPDATE leave_types SET default_allowance = 10
WHERE LOWER(name) = 'jury duty' AND default_allowance = 25;

UPDATE leave_types SET default_allowance = 5
WHERE LOWER(name) = 'bereavement' AND default_allowance = 25;

UPDATE leave_types SET default_allowance = 5
WHERE LOWER(name) = 'carers leave' AND default_allowance = 25;

UPDATE leave_types SET default_allowance = 0
WHERE LOWER(name) = 'exam leave' AND default_allowance = 25;

UPDATE leave_types SET default_allowance = 0
WHERE LOWER(name) = 'career break' AND default_allowance = 25;

UPDATE leave_types SET default_allowance = 0
WHERE LOWER(name) = 'lieu days' AND default_allowance = 25;

UPDATE leave_types SET default_allowance = 0
WHERE LOWER(name) = 'work from home' AND default_allowance = 25;

-- Fix 3: Update leave_balances that inherited the wrong 25-day default
-- for event-based types (only where total_allowance is still the default 25)
UPDATE leave_balances lb
SET total_allowance = lt.default_allowance
FROM leave_types lt
WHERE lb.leave_type_id = lt.id
  AND lb.total_allowance = 25
  AND LOWER(lt.name) IN ('bereavement', 'carers leave', 'exam leave', 'career break', 'lieu days', 'work from home')
  AND lt.default_allowance < 25;
