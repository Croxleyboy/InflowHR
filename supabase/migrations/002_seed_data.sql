-- ============================================
-- InflowHR Seed Data
-- Run this AFTER 001_initial_schema.sql
-- ============================================

-- ── Sample Employee (Andy Jones) ──
-- NOTE: Replace the auth_user_id with your actual Supabase Auth user ID
-- after you set up authentication. For now we use a placeholder.
INSERT INTO employees (id, employee_number, first_name, last_name, email, job_title, department, is_admin, start_date)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'EMP001', 'Andy', 'Jones', 'andy.jones@inflowhr.com', 'HR Director', 'Human Resources', TRUE, '2024-01-15'),
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'EMP002', 'Sarah', 'Mitchell', 'sarah.mitchell@inflowhr.com', 'Software Engineer', 'Engineering', FALSE, '2024-03-01'),
  ('c3d4e5f6-a7b8-9012-cdef-123456789012', 'EMP003', 'James', 'Wilson', 'james.wilson@inflowhr.com', 'Marketing Manager', 'Marketing', FALSE, '2024-06-10');

-- ── Expense Claims ──
INSERT INTO expense_claims (employee_id, reference_number, title, description, amount, status, category, submitted_at, approved_by, approved_at, created_at)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'EXP-084', 'testing', 'Test expense claim', 256.00, 'approved', 'General', '2026-12-01', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2026-12-03', '2026-12-04'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'EXP-083', 'Client lunch meeting', 'Lunch with client at The Ivy', 45.50, 'pending', 'Meals', '2026-11-19', NULL, NULL, '2026-11-20'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'EXP-082', 'Train tickets - London', 'Return tickets Manchester to London for conference', 128.00, 'approved', 'Travel', '2026-11-14', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2026-11-15', '2026-11-15'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'EXP-081', 'Office supplies', 'Printer paper and ink cartridges', 32.99, 'draft', 'Supplies', NULL, NULL, NULL, '2026-11-10'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'EXP-080', 'Conference registration', 'HR Tech Summit 2026', 350.00, 'pending', 'Training', '2026-10-27', NULL, NULL, '2026-10-28'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'EXP-079', 'Taxi to airport', 'Taxi for Birmingham trip', 67.00, 'approved', 'Travel', '2026-10-14', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2026-10-15', '2026-10-15');

-- ── Leave Types ──
INSERT INTO leave_types (name, default_allowance, colour)
VALUES
  ('Annual Leave', 25, '#4caf50'),
  ('Sick Leave', 10, '#f44336'),
  ('Compassionate Leave', 5, '#9c27b0'),
  ('Parental Leave', 20, '#2196f3');

-- ── Leave Balances (Andy Jones, 2026) ──
INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 2026, 28, 0, 3),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 2, 2026, 10, 2, 0);

-- ── Leave Requests ──
INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, status, reason, created_at)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, '2026-08-04', '2026-08-15', 10, 'approved', 'Summer holiday', '2026-06-15'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, '2026-12-23', '2026-12-31', 5, 'pending', 'Christmas break', '2026-11-01');

-- ── Payslips ──
INSERT INTO payslips (employee_id, reference_number, pay_period_start, pay_period_end, gross_pay, tax, national_insurance, pension, other_deductions, net_pay, payment_date, status)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'PAY-2026-07', '2026-07-01', '2026-07-31', 4500.00, 720.00, 360.00, 225.00, 0, 3195.00, '2026-07-28', 'paid'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'PAY-2026-06', '2026-06-01', '2026-06-30', 4500.00, 720.00, 360.00, 225.00, 0, 3195.00, '2026-06-28', 'paid'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'PAY-2026-05', '2026-05-01', '2026-05-31', 4500.00, 720.00, 360.00, 225.00, 0, 3195.00, '2026-05-28', 'paid');

-- ── Kudos ──
INSERT INTO kudos (from_employee_id, to_employee_id, message, category, created_at)
VALUES
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Great job leading the onboarding revamp!', 'leadership', '2026-07-10'),
  ('c3d4e5f6-a7b8-9012-cdef-123456789012', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Thanks for helping with the benefits rollout', 'teamwork', '2026-07-05'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'b2c3d4e5-f6a7-8901-bcde-f12345678901', 'Brilliant work on the API integration', 'innovation', '2026-07-12');

-- ── Benefits ──
INSERT INTO benefits (name, description, category, provider)
VALUES
  ('Health Insurance', 'Comprehensive private health cover', 'Health', 'Bupa'),
  ('Dental Plan', 'Annual dental check-ups and treatment', 'Health', 'Denplan'),
  ('Gym Membership', 'Subsidised gym membership', 'Wellbeing', 'PureGym'),
  ('Cycle to Work', 'Tax-free bicycle purchase scheme', 'Transport', 'Cyclescheme'),
  ('Life Insurance', '4x salary life insurance cover', 'Insurance', 'Aviva');

INSERT INTO employee_benefits (employee_id, benefit_id, status)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 'active'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 3, 'active'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 5, 'active');

-- ── E-Learning Courses ──
INSERT INTO courses (title, description, category, duration_minutes, is_mandatory)
VALUES
  ('Data Protection & GDPR', 'Annual mandatory GDPR training', 'Compliance', 45, TRUE),
  ('Fire Safety Awareness', 'Workplace fire safety procedures', 'Health & Safety', 30, TRUE),
  ('Unconscious Bias', 'Understanding and mitigating bias in the workplace', 'DEI', 60, FALSE),
  ('Leadership Essentials', 'Core leadership skills for managers', 'Management', 90, FALSE),
  ('Cybersecurity Basics', 'Protecting company data and systems', 'IT', 40, TRUE);

INSERT INTO course_enrolments (employee_id, course_id, status, progress_pct, started_at, completed_at, score)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 'completed', 100, '2026-03-01', '2026-03-01', 92),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 2, 'completed', 100, '2026-04-15', '2026-04-15', 88),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 3, 'in_progress', 60, '2026-07-10', NULL, NULL),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 5, 'not_started', 0, NULL, NULL, NULL);

-- ── Performance Reviews ──
INSERT INTO performance_reviews (employee_id, reviewer_id, review_period, overall_rating, strengths, areas_for_improvement, goals, status, completed_at, created_at)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'H1 2026', 4, 'Strong leadership, excellent stakeholder management', 'Delegation could be improved', 'Complete leadership course, mentor 2 junior staff', 'completed', '2026-06-30', '2026-06-01');

-- ── Announcements ──
INSERT INTO announcements (title, body, author_id, is_pinned, published_at)
VALUES
  ('Latest Company Update!', 'InflowHR now provides a new language deployment, German. Enjoy', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', TRUE, '2026-07-15'),
  ('Office Closure - Bank Holiday', 'The office will be closed on Monday 25th August for the bank holiday.', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', FALSE, '2026-07-10');

-- ── Notifications ──
INSERT INTO notifications (employee_id, title, message, type, link, is_read)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Expense Approved', 'Your expense claim EXP-084 for £256.00 has been approved', 'info', '/expenses', TRUE),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Leave Request Pending', 'Your Christmas leave request is awaiting approval', 'action', '/time-off', FALSE),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'New Kudos Received', 'Sarah Mitchell sent you a kudos for leadership', 'info', '/kudos', FALSE);
