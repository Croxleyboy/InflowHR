-- ============================================================
-- DEMO SEED: Wipe & reseed all tables
-- Keeps auth.users and company_users for andy.jones@kumonix.com
-- Creates 5 demo employees with data across every feature
-- ============================================================

-- Step 1: Delete all data (order matters for FK constraints)
DELETE FROM workflow_tracker;
DELETE FROM notifications;
DELETE FROM expense_line_items;
DELETE FROM expense_claims;
DELETE FROM leave_requests;
DELETE FROM leave_balances;
DELETE FROM course_enrolments;
DELETE FROM employee_benefits;
DELETE FROM performance_reviews;
DELETE FROM kudos;
DELETE FROM payslips;
DELETE FROM onboarding;
DELETE FROM announcements;
DELETE FROM user_settings;
DELETE FROM app_settings;
DELETE FROM company_users;
DELETE FROM employees;
DELETE FROM leave_types;
DELETE FROM benefits;
DELETE FROM courses;
DELETE FROM companies;

-- Step 2: Create the Kumonix company
INSERT INTO companies (id, name, microsoft_tenant_id, domain, is_active)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Kumonix',
  'placeholder-tenant-id',
  'kumonix.com',
  true
);

-- Step 3: Create 5 employees (Andy is admin + manager)
INSERT INTO employees (id, employee_number, first_name, last_name, email, job_title, department, manager_id, start_date, phone, is_admin, is_active, can_post_notifications, company_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EMP001', 'Andy',    'Jones',    'andy.jones@kumonix.com',    'Head of IT',          'IT',         NULL, '2022-01-10', '+44 7700 100001', true,  true, true,  '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'EMP002', 'Sarah',   'Mitchell', 'sarah.mitchell@kumonix.com','Software Engineer',   'Engineering', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2023-03-15', '+44 7700 100002', false, true, false, '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'EMP003', 'James',   'Patel',    'james.patel@kumonix.com',   'Product Designer',    'Design',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2023-06-01', '+44 7700 100003', false, true, false, '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'EMP004', 'Emma',    'Chen',     'emma.chen@kumonix.com',     'HR Manager',          'HR',         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2022-09-01', '+44 7700 100004', false, true, true,  '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'EMP005', 'Tom',     'Williams', 'tom.williams@kumonix.com',  'Finance Analyst',     'Finance',    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2024-01-08', '+44 7700 100005', false, true, false, '11111111-1111-1111-1111-111111111111');

-- Step 4: Link auth user to company (andy.jones@kumonix.com)
-- Find the auth user by email and create the company_users link
INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
SELECT
  au.id,
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'admin',
  true
FROM auth.users au
WHERE au.email = 'andy.jones@kumonix.com'
LIMIT 1;

-- Step 5: Leave types
INSERT INTO leave_types (id, name, default_allowance, colour, is_active, company_id) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Annual Leave',     25, '#4caf50', true, '11111111-1111-1111-1111-111111111111'),
  (2, 'Sick Leave',       10, '#f44336', true, '11111111-1111-1111-1111-111111111111'),
  (3, 'Parental Leave',   14, '#9c27b0', true, '11111111-1111-1111-1111-111111111111'),
  (4, 'Compassionate',     5, '#607d8b', true, '11111111-1111-1111-1111-111111111111'),
  (5, 'Work From Home',  999, '#2196f3', true, '11111111-1111-1111-1111-111111111111');
SELECT setval(pg_get_serial_sequence('leave_types', 'id'), 10);

-- Step 6: Leave balances (2026)
INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over, company_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 2026, 28, 5, 3, '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, 2026, 10, 1, 0, '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 2026, 25, 8, 0, '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, 2026, 10, 2, 0, '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 1, 2026, 25, 3, 0, '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 2, 2026, 10, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, 2026, 25, 6, 2, '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 2, 2026, 10, 1, 0, '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 1, 2026, 25, 2, 0, '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 2, 2026, 10, 0, 0, '11111111-1111-1111-1111-111111111111');

-- Step 7: Leave requests (mix of statuses)
INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, status, reason, approved_by, approved_at, company_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, '2026-08-04', '2026-08-08', 5, 'approved', 'Summer holiday',   'dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-07-10 09:00:00+00', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, '2026-07-28', '2026-07-30', 3, 'pending',  'Family event',     NULL, NULL, '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, '2026-06-16', '2026-06-17', 2, 'approved', 'Feeling unwell',   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-06-16 08:30:00+00', '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 1, '2026-09-01', '2026-09-05', 5, 'pending',  'Conference travel', NULL, NULL, '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, '2026-12-23', '2026-12-31', 6, 'approved', 'Christmas break',  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11-15 10:00:00+00', '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 1, '2026-08-18', '2026-08-19', 2, 'pending',  'Moving house',     NULL, NULL, '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, '2026-05-12', '2026-05-12', 1, 'approved', 'Dental appointment','dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-05-12 07:00:00+00', '11111111-1111-1111-1111-111111111111');

-- Step 8: Expense claims with line items
INSERT INTO expense_claims (id, employee_id, reference_number, title, description, amount, status, category, submitted_at, start_date, end_date, cost_center, company_id) OVERRIDING SYSTEM VALUE VALUES
  (1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EXP-2026-001', 'Client lunch meeting',       'Lunch with Acme Corp',     85.50,  'approved',  'Meals',           '2026-07-01 10:00:00+00', '2026-07-01', '2026-07-01', 'External expenses', '11111111-1111-1111-1111-111111111111'),
  (2, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'EXP-2026-002', 'Train to London office',     'Return ticket Kings Cross', 124.00, 'pending',   'Travel',          '2026-07-10 14:00:00+00', '2026-07-10', '2026-07-10', 'External expenses', '11111111-1111-1111-1111-111111111111'),
  (3, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'EXP-2026-003', 'Design software licence',    'Figma annual renewal',     168.00, 'submitted', 'Software',        '2026-07-15 09:00:00+00', '2026-07-15', '2026-07-15', 'IT costs',          '11111111-1111-1111-1111-111111111111'),
  (4, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'EXP-2026-004', 'Office supplies',            'Stationery & notebooks',    42.99, 'draft',     'Office Supplies', NULL,                      '2026-07-18', '2026-07-18', 'External expenses', '11111111-1111-1111-1111-111111111111'),
  (5, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'EXP-2026-005', 'Team building dinner',       'Team meal at Nandos',      210.75, 'approved',  'Meals',           '2026-06-20 11:00:00+00', '2026-06-20', '2026-06-20', 'HR budget',         '11111111-1111-1111-1111-111111111111');
SELECT setval(pg_get_serial_sequence('expense_claims', 'id'), 10);

INSERT INTO expense_line_items (expense_claim_id, title, expense_type, description, date_of_purchase, amount, company_id) VALUES
  (1, 'Restaurant bill',      'Meals',    'Italian restaurant',    '2026-07-01', 72.00,  '11111111-1111-1111-1111-111111111111'),
  (1, 'Taxi to restaurant',   'Travel',   'Uber return trip',      '2026-07-01', 13.50,  '11111111-1111-1111-1111-111111111111'),
  (2, 'Train ticket outbound', 'Travel',  'Kings Cross return',    '2026-07-10', 62.00,  '11111111-1111-1111-1111-111111111111'),
  (2, 'Train ticket return',   'Travel',  'Kings Cross return',    '2026-07-10', 62.00,  '11111111-1111-1111-1111-111111111111'),
  (3, 'Figma licence',         'Software','Annual subscription',   '2026-07-15', 168.00, '11111111-1111-1111-1111-111111111111'),
  (4, 'Notebooks and pens',    'Office Supplies','WHSmith purchase','2026-07-18', 42.99, '11111111-1111-1111-1111-111111111111'),
  (5, 'Restaurant bill',       'Meals',   'Team dinner 6 people',  '2026-06-20', 185.75, '11111111-1111-1111-1111-111111111111'),
  (5, 'Drinks',                'Meals',   'Soft drinks',           '2026-06-20', 25.00,  '11111111-1111-1111-1111-111111111111');

-- Step 9: Payslips (April–July 2026 for all employees)
INSERT INTO payslips (employee_id, reference_number, pay_period_start, pay_period_end, gross_pay, tax, national_insurance, pension, other_deductions, net_pay, payment_date, status, tax_code, annual_salary, payroll_id, bank_account, payroll_office, overtime, adjustments, monthly_deductions, company_id) VALUES
  -- Andy (£65k)
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PAY-2026-04-AJ', '2026-04-01', '2026-04-30', 5416.67, 1083.33, 432.00, 271.00, 0, 3630.34, '2026-04-28', 'paid', '1257L', 65000, 'KMX-001', '****4521', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PAY-2026-05-AJ', '2026-05-01', '2026-05-31', 5416.67, 1083.33, 432.00, 271.00, 0, 3630.34, '2026-05-28', 'paid', '1257L', 65000, 'KMX-001', '****4521', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PAY-2026-06-AJ', '2026-06-01', '2026-06-30', 5416.67, 1083.33, 432.00, 271.00, 0, 3630.34, '2026-06-26', 'paid', '1257L', 65000, 'KMX-001', '****4521', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PAY-2026-07-AJ', '2026-07-01', '2026-07-31', 5416.67, 1083.33, 432.00, 271.00, 0, 3630.34, '2026-07-28', 'processed', '1257L', 65000, 'KMX-001', '****4521', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  -- Sarah (£48k)
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PAY-2026-04-SM', '2026-04-01', '2026-04-30', 4000.00, 720.00, 340.00, 200.00, 0, 2740.00, '2026-04-28', 'paid', '1257L', 48000, 'KMX-002', '****8832', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PAY-2026-05-SM', '2026-05-01', '2026-05-31', 4000.00, 720.00, 340.00, 200.00, 0, 2740.00, '2026-05-28', 'paid', '1257L', 48000, 'KMX-002', '****8832', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PAY-2026-06-SM', '2026-06-01', '2026-06-30', 4000.00, 720.00, 340.00, 200.00, 0, 2740.00, '2026-06-26', 'paid', '1257L', 48000, 'KMX-002', '****8832', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PAY-2026-07-SM', '2026-07-01', '2026-07-31', 4000.00, 720.00, 340.00, 200.00, 0, 2740.00, '2026-07-28', 'processed', '1257L', 48000, 'KMX-002', '****8832', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  -- James (£45k)
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PAY-2026-04-JP', '2026-04-01', '2026-04-30', 3750.00, 650.00, 310.00, 187.50, 0, 2602.50, '2026-04-28', 'paid', '1257L', 45000, 'KMX-003', '****1199', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PAY-2026-05-JP', '2026-05-01', '2026-05-31', 3750.00, 650.00, 310.00, 187.50, 0, 2602.50, '2026-05-28', 'paid', '1257L', 45000, 'KMX-003', '****1199', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PAY-2026-06-JP', '2026-06-01', '2026-06-30', 3750.00, 650.00, 310.00, 187.50, 0, 2602.50, '2026-06-26', 'paid', '1257L', 45000, 'KMX-003', '****1199', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PAY-2026-07-JP', '2026-07-01', '2026-07-31', 3750.00, 650.00, 310.00, 187.50, 0, 2602.50, '2026-07-28', 'processed', '1257L', 45000, 'KMX-003', '****1199', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  -- Emma (£52k)
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'PAY-2026-04-EC', '2026-04-01', '2026-04-30', 4333.33, 816.67, 370.00, 216.67, 0, 2929.99, '2026-04-28', 'paid', '1257L', 52000, 'KMX-004', '****3347', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'PAY-2026-05-EC', '2026-05-01', '2026-05-31', 4333.33, 816.67, 370.00, 216.67, 0, 2929.99, '2026-05-28', 'paid', '1257L', 52000, 'KMX-004', '****3347', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'PAY-2026-06-EC', '2026-06-01', '2026-06-30', 4333.33, 816.67, 370.00, 216.67, 0, 2929.99, '2026-06-26', 'paid', '1257L', 52000, 'KMX-004', '****3347', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'PAY-2026-07-EC', '2026-07-01', '2026-07-31', 4333.33, 816.67, 370.00, 216.67, 0, 2929.99, '2026-07-28', 'processed', '1257L', 52000, 'KMX-004', '****3347', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  -- Tom (£38k)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'PAY-2026-04-TW', '2026-04-01', '2026-04-30', 3166.67, 533.33, 270.00, 158.33, 0, 2205.01, '2026-04-28', 'paid', '1257L', 38000, 'KMX-005', '****6673', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'PAY-2026-05-TW', '2026-05-01', '2026-05-31', 3166.67, 533.33, 270.00, 158.33, 0, 2205.01, '2026-05-28', 'paid', '1257L', 38000, 'KMX-005', '****6673', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'PAY-2026-06-TW', '2026-06-01', '2026-06-30', 3166.67, 533.33, 270.00, 158.33, 0, 2205.01, '2026-06-26', 'paid', '1257L', 38000, 'KMX-005', '****6673', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'PAY-2026-07-TW', '2026-07-01', '2026-07-31', 3166.67, 533.33, 270.00, 158.33, 0, 2205.01, '2026-07-28', 'processed', '1257L', 38000, 'KMX-005', '****6673', 'London', 0, 0, 0, '11111111-1111-1111-1111-111111111111');

-- Step 10: Kudos
INSERT INTO kudos (from_employee_id, to_employee_id, message, category, recognition_type, badge, quality, is_broadcast, like_count, liked_by, company_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Brilliant work on the API refactor — shipped two days early!', 'innovation', 'recognition', 'star', 'Innovation', false, 3, ARRAY['cccccccc-cccc-cccc-cccc-cccccccccccc','dddddddd-dddd-dddd-dddd-dddddddddddd','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee']::uuid[], '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'The new dashboard mockups look incredible. Thanks for the quick turnaround!', 'teamwork', 'recognition', 'heart', 'Teamwork', false, 2, ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee']::uuid[], '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Thank you for mentoring the new joiners — they all feel so welcome!', 'leadership', 'recognition', 'trophy', 'Leadership', false, 4, ARRAY['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc','dddddddd-dddd-dddd-dddd-dddddddddddd','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee']::uuid[], '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Great job catching that budget discrepancy before month-end close!', 'customer_focus', 'recognition', 'gem', 'Attention to Detail', false, 1, ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[], '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', NULL, 'Happy Friday everyone! Have a great weekend 🎉', NULL, 'broadcast', NULL, NULL, true, 2, ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','dddddddd-dddd-dddd-dddd-dddddddddddd']::uuid[], '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Your presentation at the all-hands was engaging and clear. Well done!', 'going_above', 'recognition', 'rocket', 'Going Above & Beyond', false, 1, ARRAY['cccccccc-cccc-cccc-cccc-cccccccccccc']::uuid[], '11111111-1111-1111-1111-111111111111');

-- Step 11: Announcements
INSERT INTO announcements (title, body, author_id, is_pinned, published_at, submitted_by_name, company_id) VALUES
  ('Q3 Company All-Hands', 'Join us on August 1st at 2pm for the quarterly all-hands meeting. We will cover company performance, upcoming initiatives, and team highlights. Remote dial-in link will be shared the day before.', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true,  '2026-07-20 09:00:00+00', 'Andy Jones',  '11111111-1111-1111-1111-111111111111'),
  ('Office Closure: August Bank Holiday', 'Please note the office will be closed on Monday 31st August for the bank holiday. Normal hours resume Tuesday 1st September.', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false, '2026-07-18 10:00:00+00', 'Emma Chen',   '11111111-1111-1111-1111-111111111111'),
  ('New Benefits Portal Launch', 'We are excited to announce the launch of our updated benefits portal. You can now manage your pension contributions, cycle-to-work scheme, and health insurance all in one place.', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false, '2026-07-15 14:00:00+00', 'Emma Chen',   '11111111-1111-1111-1111-111111111111'),
  ('Welcome Tom Williams!', 'Please join us in welcoming Tom Williams to the Finance team. Tom joins as Finance Analyst and brings experience from PwC. Say hi when you see him!', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false, '2026-01-08 09:00:00+00', 'Emma Chen',   '11111111-1111-1111-1111-111111111111');

-- Step 12: Benefits
INSERT INTO benefits (id, name, description, category, provider, is_active) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Private Health Insurance', 'Comprehensive medical cover including dental and optical', 'Health', 'Bupa',           true),
  (2, 'Cycle to Work Scheme',     'Tax-free bike purchase up to £2,000',                     'Lifestyle', 'Cyclescheme',  true),
  (3, 'Pension',                   'Employer matches up to 5% of salary',                    'Financial', 'Aviva',        true),
  (4, 'Gym Membership',           'Discounted corporate rate at PureGym',                    'Health', 'PureGym',         true),
  (5, 'Mental Health Support',    'Access to counselling and wellbeing app',                  'Health', 'Headspace',       true);
SELECT setval(pg_get_serial_sequence('benefits', 'id'), 10);

-- Step 13: Employee benefits
INSERT INTO employee_benefits (employee_id, benefit_id, status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 3, 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 3, 'active'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 3, 'active'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 4, 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 3, 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 5, 'active'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 3, 'active'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 5, 'pending');

-- Step 14: Courses (eLearning)
INSERT INTO courses (id, title, description, category, duration_minutes, is_mandatory, is_active) OVERRIDING SYSTEM VALUE VALUES
  (1, 'Data Protection & GDPR',       'Understanding your obligations under UK GDPR',           'Compliance',  45, true,  true),
  (2, 'Cyber Security Awareness',     'Phishing, passwords, and safe browsing practices',       'IT Security', 30, true,  true),
  (3, 'Fire Safety',                   'Evacuation procedures and fire prevention',              'Health & Safety', 20, true, true),
  (4, 'Inclusive Leadership',          'Building diverse and inclusive teams',                    'Leadership',  60, false, true),
  (5, 'Introduction to Agile',        'Scrum, Kanban, and agile ways of working',                'Professional', 40, false, true),
  (6, 'Mental Health First Aid',       'Supporting colleagues with mental health challenges',    'Wellbeing',   90, false, true);
SELECT setval(pg_get_serial_sequence('courses', 'id'), 10);

-- Step 15: Course enrolments
INSERT INTO course_enrolments (employee_id, course_id, status, progress_pct, started_at, completed_at, score) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 'completed',   100, '2026-02-01 10:00:00+00', '2026-02-01 10:45:00+00', 92),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, 'completed',   100, '2026-02-15 14:00:00+00', '2026-02-15 14:30:00+00', 88),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 3, 'completed',   100, '2026-03-01 09:00:00+00', '2026-03-01 09:20:00+00', 95),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 4, 'in_progress',  60, '2026-07-10 11:00:00+00', NULL, NULL),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 'completed',   100, '2026-04-01 10:00:00+00', '2026-04-01 10:40:00+00', 85),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, 'completed',   100, '2026-04-05 14:00:00+00', '2026-04-05 14:25:00+00', 90),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 3, 'in_progress',  40, '2026-07-15 09:00:00+00', NULL, NULL),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 5, 'completed',   100, '2026-05-10 10:00:00+00', '2026-05-10 10:40:00+00', 78),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 1, 'completed',   100, '2026-07-01 10:00:00+00', '2026-07-01 10:50:00+00', 91),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 2, 'not_started',   0, NULL, NULL, NULL),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 3, 'not_started',   0, NULL, NULL, NULL),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, 'completed',   100, '2026-01-15 10:00:00+00', '2026-01-15 10:42:00+00', 97),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 2, 'completed',   100, '2026-01-20 14:00:00+00', '2026-01-20 14:28:00+00', 94),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 3, 'completed',   100, '2026-02-01 09:00:00+00', '2026-02-01 09:18:00+00', 100),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 6, 'in_progress',  75, '2026-07-01 10:00:00+00', NULL, NULL),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 1, 'in_progress',  30, '2026-07-20 10:00:00+00', NULL, NULL),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 2, 'not_started',   0, NULL, NULL, NULL),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 3, 'not_started',   0, NULL, NULL, NULL);

-- Step 16: Performance reviews
INSERT INTO performance_reviews (employee_id, reviewer_id, review_period, overall_rating, strengths, areas_for_improvement, goals, status, completed_at) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'H1 2026', 4, 'Strong technical skills, reliable delivery, excellent code quality', 'Could contribute more in team meetings and share knowledge proactively', 'Lead a tech talk by end of Q3; mentor one junior developer', 'completed', '2026-07-01 10:00:00+00'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'H1 2026', 4, 'Creative design thinking, fast iteration, good user empathy', 'Needs to improve stakeholder communication and documentation', 'Complete design system v2; run a user research session independently', 'completed', '2026-07-02 11:00:00+00'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'H1 2026', 5, 'Exceptional at employee relations, process improvement champion', 'Could delegate more to build team capacity', 'Implement new onboarding flow; reduce time-to-hire by 15%', 'completed', '2026-07-03 14:00:00+00'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'H1 2026', 3, 'Good analytical skills, enthusiastic learner, adapting well to the team', 'Still ramping up on company-specific processes and tooling', 'Complete all mandatory training; own the monthly variance report by Q4', 'in_progress', NULL),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'H1 2026', 5, 'Visionary leadership, strong technical judgment, excellent team builder', 'Work-life balance — tendency to overcommit', 'Delegate two standing responsibilities; take full annual leave allocation', 'completed', '2026-07-05 09:00:00+00');

-- Step 17: Onboarding records
INSERT INTO onboarding (user_action, status, firstname, surname, start_date, user_email, job_title, department, employee_number, manager, manager_email, contract_type, location, company_id) VALUES
  ('Joiner', 'complete',    'Sarah',   'Mitchell', '2023-03-15', 'sarah.mitchell@kumonix.com','Software Engineer',  'Engineering', 'EMP002', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', '11111111-1111-1111-1111-111111111111'),
  ('Joiner', 'complete',    'James',   'Patel',    '2023-06-01', 'james.patel@kumonix.com',  'Product Designer',   'Design',      'EMP003', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', '11111111-1111-1111-1111-111111111111'),
  ('Joiner', 'complete',    'Emma',    'Chen',     '2022-09-01', 'emma.chen@kumonix.com',    'HR Manager',         'HR',          'EMP004', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', '11111111-1111-1111-1111-111111111111'),
  ('Joiner', 'in_progress', 'Tom',     'Williams', '2024-01-08', 'tom.williams@kumonix.com', 'Finance Analyst',    'Finance',     'EMP005', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', '11111111-1111-1111-1111-111111111111'),
  ('Joiner', 'new',         'Rachel',  'Green',    '2026-09-01', 'rachel.green@kumonix.com', 'Marketing Manager',  'Marketing',   'EMP006', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', '11111111-1111-1111-1111-111111111111');

-- Step 18: Workflow tracker (pending actions for Andy as manager)
INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, approval_id, task_description, company_id) VALUES
  ('Sarah Mitchell', 1, 'Pending',  'Leave',   'Approve annual leave',           'sarah.mitchell@kumonix.com', 'andy.jones@kumonix.com', NULL, 'Sarah Mitchell has requested 3 days annual leave (28-30 Jul 2026)', '11111111-1111-1111-1111-111111111111'),
  ('James Patel',    1, 'Pending',  'Leave',   'Approve annual leave',           'james.patel@kumonix.com',    'andy.jones@kumonix.com', NULL, 'James Patel has requested 5 days annual leave (1-5 Sep 2026)',      '11111111-1111-1111-1111-111111111111'),
  ('Tom Williams',   1, 'Pending',  'Leave',   'Approve annual leave',           'tom.williams@kumonix.com',   'andy.jones@kumonix.com', NULL, 'Tom Williams has requested 2 days annual leave (18-19 Aug 2026)',   '11111111-1111-1111-1111-111111111111'),
  ('Sarah Mitchell', 1, 'Pending',  'Expense', 'Approve expense claim',          'sarah.mitchell@kumonix.com', 'andy.jones@kumonix.com', 2,   'Train to London office — £124.00',                                 '11111111-1111-1111-1111-111111111111'),
  ('James Patel',    1, 'Pending',  'Expense', 'Approve expense claim',          'james.patel@kumonix.com',    'andy.jones@kumonix.com', 3,   'Design software licence — £168.00',                                '11111111-1111-1111-1111-111111111111'),
  ('Andy Jones',     1, 'Complete', 'Expense', 'Expense claim approved',         'andy.jones@kumonix.com',     'andy.jones@kumonix.com', 1,   'Client lunch meeting — £85.50',                                    '11111111-1111-1111-1111-111111111111'),
  ('Emma Chen',      1, 'Complete', 'Expense', 'Expense claim approved',         'emma.chen@kumonix.com',      'andy.jones@kumonix.com', 5,   'Team building dinner — £210.75',                                   '11111111-1111-1111-1111-111111111111'),
  ('Sarah Mitchell', 1, 'Complete', 'Leave',   'Sick leave approved',            'sarah.mitchell@kumonix.com', 'andy.jones@kumonix.com', NULL, '2 days sick leave (16-17 Jun 2026)',                               '11111111-1111-1111-1111-111111111111');

-- Step 19: Notifications
INSERT INTO notifications (employee_id, title, message, type, is_read, company_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Leave request pending',      'Sarah Mitchell has submitted a leave request for your approval',    'action', false, '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Expense claim pending',      'Sarah Mitchell submitted an expense claim (EXP-2026-002) for £124.00', 'action', false, '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'New kudos received',         'Emma Chen sent you a kudos for mentoring new joiners',             'info',   true,  '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Leave approved',             'Your sick leave (16-17 Jun) has been approved by Andy Jones',      'info',   true,  '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'New kudos received',         'Andy Jones sent you a kudos — great work on the API refactor!',    'info',   false, '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Mandatory training due',     'Cyber Security Awareness course is overdue — please complete ASAP','alert',  false, '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Welcome to Kumonix!',       'Complete your onboarding checklist to get started',                'info',   true,  '11111111-1111-1111-1111-111111111111');

-- Step 20: App settings
INSERT INTO app_settings (id, language, financial_year_start_month, country_code, company_id)
VALUES (1, 'en', 4, 'GB', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO UPDATE SET
  language = EXCLUDED.language,
  financial_year_start_month = EXCLUDED.financial_year_start_month,
  country_code = EXCLUDED.country_code,
  company_id = EXCLUDED.company_id;

-- Step 21: User settings
INSERT INTO user_settings (employee_id, language, features_config) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'de', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}');

-- Done! The Kumonix tenant ID will be updated automatically
-- when andy.jones@kumonix.com next signs in via the SSO trigger.
