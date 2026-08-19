-- Seed the baseline/core subscription pricing row
-- This represents the core HR platform price that every company pays per user
-- is_addon = false distinguishes it from add-on features
-- Baseline includes: Expenses, Leave, Kudos, Announcements, Onboarding, HR Tickets,
--   E-Learning, Timesheets, Payroll/Payslips, Performance
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
SELECT 'hr_core', 'HR Core Platform', 'Expenses, Leave, Kudos, Announcements, Onboarding, HR Tickets, E-Learning, Timesheets, Payroll/Payslips, Performance', 5.00, false, true
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_pricing WHERE feature_key = 'hr_core'
);

-- Ensure add-on rows exist for the four add-on features
-- Benefits
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
SELECT 'benefits', 'Benefits', 'Employee benefits management and enrolment', 1.00, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_pricing WHERE feature_key = 'benefits'
);

-- Legal Timesheets
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
SELECT 'legal_timesheets', 'Legal Timesheets', 'Legal-grade timesheet tracking and billing', 1.50, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_pricing WHERE feature_key = 'legal_timesheets'
);

-- Shifts & Rotas
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
SELECT 'shifts', 'Shifts & Rotas', 'Shift scheduling and rota management', 1.50, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_pricing WHERE feature_key = 'shifts'
);

-- Space Booking (may already exist from migration 033)
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
SELECT 'space_booking', 'Space Booking', 'Desk and meeting room booking for employees', 1.00, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_pricing WHERE feature_key = 'space_booking'
);

-- Remove any rows that were previously add-ons but are now part of baseline
-- (e.g. if timesheets, performance, elearning, payroll were separate add-on rows)
DELETE FROM subscription_pricing
WHERE feature_key IN ('expenses', 'leave', 'kudos', 'announcements', 'onboarding', 'hr_tickets', 'elearning', 'timesheets', 'payroll', 'performance')
  AND is_addon = true;
