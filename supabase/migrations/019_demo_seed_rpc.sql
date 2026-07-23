-- ============================================================
-- RPC function for demo seed (bypasses RLS via SECURITY DEFINER)
-- Called from admin portal: supabase.rpc('run_demo_seed', { auth_uid })
-- ============================================================

CREATE OR REPLACE FUNCTION public.run_demo_seed(p_auth_uid uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid := '11111111-1111-1111-1111-111111111111';
  v_andy uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_sarah uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_james uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_emma uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_tom uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_tenant_id text;
  v_lt_annual bigint;
  v_lt_sick bigint;
  v_claim1 bigint;
  v_claim2 bigint;
  v_claim3 bigint;
  v_claim4 bigint;
  v_claim5 bigint;
  v_ben_health bigint;
  v_ben_cycle bigint;
  v_ben_pension bigint;
  v_ben_gym bigint;
  v_ben_mental bigint;
  v_c_gdpr bigint;
  v_c_cyber bigint;
  v_c_fire bigint;
  v_c_inclusive bigint;
  v_c_agile bigint;
  v_c_mhfa bigint;
BEGIN
  -- Verify caller exists in auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_auth_uid) THEN
    RAISE EXCEPTION 'Invalid auth user';
  END IF;

  -- Extract real Microsoft tenant ID from auth metadata
  SELECT COALESCE(
    raw_user_meta_data -> 'custom_claims' ->> 'tid',
    raw_app_meta_data ->> 'provider_id',
    'placeholder-tenant-id'
  ) INTO v_tenant_id
  FROM auth.users WHERE id = p_auth_uid;

  -- ========== WIPE ALL DATA ==========
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
  DELETE FROM app_settings WHERE true;
  DELETE FROM company_users;
  DELETE FROM employees;
  DELETE FROM leave_types;
  DELETE FROM benefits;
  DELETE FROM courses;
  DELETE FROM companies;

  -- ========== COMPANY (uses real tenant ID from auth metadata) ==========
  INSERT INTO companies (id, name, microsoft_tenant_id, domain, is_active)
  VALUES (v_company_id, 'Kumonix', v_tenant_id, 'kumonix.com', true);

  -- ========== EMPLOYEES ==========
  INSERT INTO employees (id, employee_number, first_name, last_name, email, job_title, department, manager_id, start_date, phone, is_admin, is_active, can_post_notifications, company_id) VALUES
    (v_andy,  'EMP001', 'Andy',  'Jones',    'andy.jones@kumonix.com',    'Head of IT',        'IT',          NULL,    '2022-01-10', '+44 7700 100001', true,  true, true,  v_company_id),
    (v_sarah, 'EMP002', 'Sarah', 'Mitchell', 'sarah.mitchell@kumonix.com','Software Engineer', 'Engineering', v_andy,  '2023-03-15', '+44 7700 100002', false, true, false, v_company_id),
    (v_james, 'EMP003', 'James', 'Patel',    'james.patel@kumonix.com',  'Product Designer',  'Design',      v_andy,  '2023-06-01', '+44 7700 100003', false, true, false, v_company_id),
    (v_emma,  'EMP004', 'Emma',  'Chen',     'emma.chen@kumonix.com',    'HR Manager',        'HR',          v_andy,  '2022-09-01', '+44 7700 100004', false, true, true,  v_company_id),
    (v_tom,   'EMP005', 'Tom',   'Williams', 'tom.williams@kumonix.com', 'Finance Analyst',   'Finance',     v_andy,  '2024-01-08', '+44 7700 100005', false, true, false, v_company_id);

  -- ========== COMPANY_USERS (link auth user) ==========
  INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
  VALUES (p_auth_uid, v_company_id, v_andy, 'admin', true);

  -- ========== LEAVE TYPES ==========
  INSERT INTO leave_types (name, default_allowance, colour, is_active, company_id) VALUES
    ('Annual Leave',    25, '#4caf50', true, v_company_id),
    ('Sick Leave',      10, '#f44336', true, v_company_id),
    ('Parental Leave',  14, '#9c27b0', true, v_company_id),
    ('Compassionate',    5, '#607d8b', true, v_company_id),
    ('Work From Home', 999, '#2196f3', true, v_company_id);

  SELECT id INTO v_lt_annual FROM leave_types WHERE name='Annual Leave' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_lt_sick FROM leave_types WHERE name='Sick Leave' AND company_id=v_company_id LIMIT 1;

  -- ========== LEAVE BALANCES ==========
  INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over, company_id) VALUES
    (v_andy,  v_lt_annual, 2026, 28, 5, 3, v_company_id),
    (v_andy,  v_lt_sick,   2026, 10, 1, 0, v_company_id),
    (v_sarah, v_lt_annual, 2026, 25, 8, 0, v_company_id),
    (v_sarah, v_lt_sick,   2026, 10, 2, 0, v_company_id),
    (v_james, v_lt_annual, 2026, 25, 3, 0, v_company_id),
    (v_james, v_lt_sick,   2026, 10, 0, 0, v_company_id),
    (v_emma,  v_lt_annual, 2026, 25, 6, 2, v_company_id),
    (v_emma,  v_lt_sick,   2026, 10, 1, 0, v_company_id),
    (v_tom,   v_lt_annual, 2026, 25, 2, 0, v_company_id),
    (v_tom,   v_lt_sick,   2026, 10, 0, 0, v_company_id);

  -- ========== LEAVE REQUESTS ==========
  INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, status, reason, approved_by, company_id) VALUES
    (v_andy,  v_lt_annual, '2026-08-04', '2026-08-08', 5, 'approved', 'Summer holiday',     v_emma, v_company_id),
    (v_sarah, v_lt_annual, '2026-07-28', '2026-07-30', 3, 'pending',  'Family event',       NULL,   v_company_id),
    (v_sarah, v_lt_sick,   '2026-06-16', '2026-06-17', 2, 'approved', 'Feeling unwell',     v_andy, v_company_id),
    (v_james, v_lt_annual, '2026-09-01', '2026-09-05', 5, 'pending',  'Conference travel',  NULL,   v_company_id),
    (v_emma,  v_lt_annual, '2026-12-23', '2026-12-31', 6, 'approved', 'Christmas break',    v_andy, v_company_id),
    (v_tom,   v_lt_annual, '2026-08-18', '2026-08-19', 2, 'pending',  'Moving house',       NULL,   v_company_id),
    (v_andy,  v_lt_sick,   '2026-05-12', '2026-05-12', 1, 'approved', 'Dental appointment', v_emma, v_company_id);

  -- ========== EXPENSE CLAIMS ==========
  INSERT INTO expense_claims (employee_id, reference_number, title, description, amount, status, category, submitted_at, start_date, end_date, company_id)
  VALUES
    (v_andy,  'EXP-2026-001', 'Client lunch meeting',    'Lunch with Acme Corp',      85.50,  'approved',  'Meals',           '2026-07-01T10:00:00Z', '2026-07-01', '2026-07-01', v_company_id),
    (v_sarah, 'EXP-2026-002', 'Train to London office',  'Return ticket Kings Cross', 124.00, 'pending',   'Travel',          '2026-07-10T14:00:00Z', '2026-07-10', '2026-07-10', v_company_id),
    (v_james, 'EXP-2026-003', 'Design software licence', 'Figma annual renewal',      168.00, 'submitted', 'Software',        '2026-07-15T09:00:00Z', '2026-07-15', '2026-07-15', v_company_id),
    (v_tom,   'EXP-2026-004', 'Office supplies',         'Stationery & notebooks',     42.99, 'draft',     'Office Supplies', NULL,                    '2026-07-18', '2026-07-18', v_company_id),
    (v_emma,  'EXP-2026-005', 'Team building dinner',    'Team meal at Nandos',       210.75, 'approved',  'Meals',           '2026-06-20T11:00:00Z', '2026-06-20', '2026-06-20', v_company_id);

  SELECT id INTO v_claim1 FROM expense_claims WHERE reference_number='EXP-2026-001' LIMIT 1;
  SELECT id INTO v_claim2 FROM expense_claims WHERE reference_number='EXP-2026-002' LIMIT 1;
  SELECT id INTO v_claim3 FROM expense_claims WHERE reference_number='EXP-2026-003' LIMIT 1;
  SELECT id INTO v_claim4 FROM expense_claims WHERE reference_number='EXP-2026-004' LIMIT 1;
  SELECT id INTO v_claim5 FROM expense_claims WHERE reference_number='EXP-2026-005' LIMIT 1;

  -- ========== EXPENSE LINE ITEMS ==========
  INSERT INTO expense_line_items (expense_claim_id, title, expense_type, description, date_of_purchase, amount, company_id) VALUES
    (v_claim1, 'Restaurant bill',      'Meals',           'Italian restaurant',   '2026-07-01', 72.00,  v_company_id),
    (v_claim1, 'Taxi to restaurant',   'Travel',          'Uber return trip',     '2026-07-01', 13.50,  v_company_id),
    (v_claim2, 'Train ticket outbound','Travel',          'Kings Cross return',   '2026-07-10', 62.00,  v_company_id),
    (v_claim2, 'Train ticket return',  'Travel',          'Kings Cross return',   '2026-07-10', 62.00,  v_company_id),
    (v_claim3, 'Figma licence',        'Software',        'Annual subscription',  '2026-07-15', 168.00, v_company_id),
    (v_claim4, 'Notebooks and pens',   'Office Supplies', 'WHSmith purchase',     '2026-07-18', 42.99,  v_company_id),
    (v_claim5, 'Restaurant bill',      'Meals',           'Team dinner 6 people', '2026-06-20', 185.75, v_company_id),
    (v_claim5, 'Drinks',               'Meals',           'Soft drinks',          '2026-06-20', 25.00,  v_company_id);

  -- ========== PAYSLIPS (Apr-Jul 2026, all 5 employees) ==========
  INSERT INTO payslips (employee_id, reference_number, pay_period_start, pay_period_end, gross_pay, tax, national_insurance, pension, other_deductions, net_pay, payment_date, status, tax_code, annual_salary, payroll_id, bank_account, payroll_office, overtime, adjustments, monthly_deductions, company_id)
  SELECT
    e.id,
    'PAY-2026-' || lpad(m.mon::text, 2, '0') || '-' || left(e.first_name,1) || left(e.last_name,1),
    make_date(2026, m.mon, 1),
    (make_date(2026, m.mon, 1) + interval '1 month - 1 day')::date,
    round(e.annual_sal / 12, 2),
    round(e.annual_sal / 12 * 0.20, 2),
    round(e.annual_sal / 12 * 0.08, 2),
    round(e.annual_sal / 12 * 0.05, 2),
    0,
    round(e.annual_sal / 12 * 0.67, 2),
    (make_date(2026, m.mon, 1) + interval '1 month - 4 day')::date,
    CASE WHEN m.mon = 7 THEN 'processed' ELSE 'paid' END,
    '1257L',
    e.annual_sal,
    'KMX-' || lpad(e.emp_idx::text, 3, '0'),
    '****' || (1000 + e.emp_idx * 1111)::text,
    'London', 0, 0, 0, v_company_id
  FROM (VALUES
    (v_andy,  'Andy',  'Jones',    65000, 1),
    (v_sarah, 'Sarah', 'Mitchell', 48000, 2),
    (v_james, 'James', 'Patel',    45000, 3),
    (v_emma,  'Emma',  'Chen',     52000, 4),
    (v_tom,   'Tom',   'Williams', 38000, 5)
  ) AS e(id, first_name, last_name, annual_sal, emp_idx)
  CROSS JOIN (VALUES (4),(5),(6),(7)) AS m(mon);

  -- ========== KUDOS ==========
  INSERT INTO kudos (from_employee_id, to_employee_id, message, category, recognition_type, badge, quality, is_broadcast, like_count, liked_by, company_id) VALUES
    (v_andy,  v_sarah, 'Brilliant work on the API refactor - shipped two days early!',                    'innovation',     'recognition', 'star',   'Innovation',           false, 3, ARRAY[v_james, v_emma, v_tom],          v_company_id),
    (v_sarah, v_james, 'The new dashboard mockups look incredible. Thanks for the quick turnaround!',     'teamwork',       'recognition', 'heart',  'Teamwork',             false, 2, ARRAY[v_andy, v_tom],                   v_company_id),
    (v_emma,  v_andy,  'Thank you for mentoring the new joiners - they all feel so welcome!',             'leadership',     'recognition', 'trophy', 'Leadership',           false, 4, ARRAY[v_sarah, v_james, v_emma, v_tom], v_company_id),
    (v_james, v_tom,   'Great job catching that budget discrepancy before month-end close!',              'customer_focus', 'recognition', 'gem',    'Attention to Detail',  false, 1, ARRAY[v_andy],                          v_company_id),
    (v_tom,   NULL,    'Happy Friday everyone! Have a great weekend',                                      NULL,             'broadcast',   NULL,     NULL,                   true,  2, ARRAY[v_andy, v_emma],                  v_company_id),
    (v_emma,  v_sarah, 'Your presentation at the all-hands was engaging and clear. Well done!',           'going_above',    'recognition', 'rocket', 'Going Above & Beyond', false, 1, ARRAY[v_james],                         v_company_id);

  -- ========== ANNOUNCEMENTS ==========
  INSERT INTO announcements (title, body, author_id, is_pinned, published_at, submitted_by_name, company_id) VALUES
    ('Q3 Company All-Hands',              'Join us on August 1st at 2pm for the quarterly all-hands meeting. We will cover company performance, upcoming initiatives, and team highlights.', v_andy, true,  '2026-07-20T09:00:00Z', 'Andy Jones', v_company_id),
    ('Office Closure: August Bank Holiday','Please note the office will be closed on Monday 31st August for the bank holiday. Normal hours resume Tuesday 1st September.',                   v_emma, false, '2026-07-18T10:00:00Z', 'Emma Chen',  v_company_id),
    ('New Benefits Portal Launch',         'We are excited to announce the launch of our updated benefits portal. Manage pension, cycle-to-work, and health insurance in one place.',         v_emma, false, '2026-07-15T14:00:00Z', 'Emma Chen',  v_company_id),
    ('Welcome Tom Williams!',              'Please join us in welcoming Tom Williams to the Finance team. Tom joins as Finance Analyst and brings experience from PwC.',                      v_emma, false, '2026-01-08T09:00:00Z', 'Emma Chen',  v_company_id);

  -- ========== BENEFITS ==========
  INSERT INTO benefits (name, description, category, provider, is_active) VALUES
    ('Private Health Insurance', 'Comprehensive medical cover including dental and optical', 'Health',    'Bupa',        true),
    ('Cycle to Work Scheme',     'Tax-free bike purchase up to £2,000',                     'Lifestyle', 'Cyclescheme', true),
    ('Pension',                  'Employer matches up to 5% of salary',                     'Financial', 'Aviva',       true),
    ('Gym Membership',           'Discounted corporate rate at PureGym',                    'Health',    'PureGym',     true),
    ('Mental Health Support',    'Access to counselling and wellbeing app',                  'Health',    'Headspace',   true);

  SELECT id INTO v_ben_health  FROM benefits WHERE name='Private Health Insurance' LIMIT 1;
  SELECT id INTO v_ben_cycle   FROM benefits WHERE name='Cycle to Work Scheme' LIMIT 1;
  SELECT id INTO v_ben_pension FROM benefits WHERE name='Pension' LIMIT 1;
  SELECT id INTO v_ben_gym     FROM benefits WHERE name='Gym Membership' LIMIT 1;
  SELECT id INTO v_ben_mental  FROM benefits WHERE name='Mental Health Support' LIMIT 1;

  INSERT INTO employee_benefits (employee_id, benefit_id, status) VALUES
    (v_andy,  v_ben_health,  'active'), (v_andy,  v_ben_pension, 'active'),
    (v_sarah, v_ben_health,  'active'), (v_sarah, v_ben_cycle,   'active'), (v_sarah, v_ben_pension, 'active'),
    (v_james, v_ben_pension, 'active'), (v_james, v_ben_gym,     'active'),
    (v_emma,  v_ben_health,  'active'), (v_emma,  v_ben_pension, 'active'), (v_emma,  v_ben_mental,  'active'),
    (v_tom,   v_ben_pension, 'active'), (v_tom,   v_ben_mental,  'pending');

  -- ========== COURSES ==========
  INSERT INTO courses (title, description, category, duration_minutes, is_mandatory, is_active) VALUES
    ('Data Protection & GDPR',   'Understanding your obligations under UK GDPR',        'Compliance',      45, true,  true),
    ('Cyber Security Awareness', 'Phishing, passwords, and safe browsing practices',    'IT Security',     30, true,  true),
    ('Fire Safety',              'Evacuation procedures and fire prevention',            'Health & Safety', 20, true,  true),
    ('Inclusive Leadership',     'Building diverse and inclusive teams',                  'Leadership',      60, false, true),
    ('Introduction to Agile',    'Scrum, Kanban, and agile ways of working',             'Professional',    40, false, true),
    ('Mental Health First Aid',  'Supporting colleagues with mental health challenges',  'Wellbeing',       90, false, true);

  SELECT id INTO v_c_gdpr      FROM courses WHERE title='Data Protection & GDPR' LIMIT 1;
  SELECT id INTO v_c_cyber     FROM courses WHERE title='Cyber Security Awareness' LIMIT 1;
  SELECT id INTO v_c_fire      FROM courses WHERE title='Fire Safety' LIMIT 1;
  SELECT id INTO v_c_inclusive  FROM courses WHERE title='Inclusive Leadership' LIMIT 1;
  SELECT id INTO v_c_agile     FROM courses WHERE title='Introduction to Agile' LIMIT 1;
  SELECT id INTO v_c_mhfa      FROM courses WHERE title='Mental Health First Aid' LIMIT 1;

  INSERT INTO course_enrolments (employee_id, course_id, status, progress_pct, started_at, completed_at, score) VALUES
    (v_andy,  v_c_gdpr,      'completed',   100, '2026-02-01T10:00:00Z', '2026-02-01T10:45:00Z', 92),
    (v_andy,  v_c_cyber,     'completed',   100, '2026-02-15T14:00:00Z', '2026-02-15T14:30:00Z', 88),
    (v_andy,  v_c_fire,      'completed',   100, '2026-03-01T09:00:00Z', '2026-03-01T09:20:00Z', 95),
    (v_andy,  v_c_inclusive, 'in_progress',  60, '2026-07-10T11:00:00Z', NULL, NULL),
    (v_sarah, v_c_gdpr,      'completed',   100, '2026-04-01T10:00:00Z', '2026-04-01T10:40:00Z', 85),
    (v_sarah, v_c_cyber,     'completed',   100, '2026-04-05T14:00:00Z', '2026-04-05T14:25:00Z', 90),
    (v_sarah, v_c_fire,      'in_progress',  40, '2026-07-15T09:00:00Z', NULL, NULL),
    (v_sarah, v_c_agile,     'completed',   100, '2026-05-10T10:00:00Z', '2026-05-10T10:40:00Z', 78),
    (v_james, v_c_gdpr,      'completed',   100, '2026-07-01T10:00:00Z', '2026-07-01T10:50:00Z', 91),
    (v_james, v_c_cyber,     'not_started',   0, NULL, NULL, NULL),
    (v_james, v_c_fire,      'not_started',   0, NULL, NULL, NULL),
    (v_emma,  v_c_gdpr,      'completed',   100, '2026-01-15T10:00:00Z', '2026-01-15T10:42:00Z', 97),
    (v_emma,  v_c_cyber,     'completed',   100, '2026-01-20T14:00:00Z', '2026-01-20T14:28:00Z', 94),
    (v_emma,  v_c_fire,      'completed',   100, '2026-02-01T09:00:00Z', '2026-02-01T09:18:00Z', 100),
    (v_emma,  v_c_mhfa,      'in_progress',  75, '2026-07-01T10:00:00Z', NULL, NULL),
    (v_tom,   v_c_gdpr,      'in_progress',  30, '2026-07-20T10:00:00Z', NULL, NULL),
    (v_tom,   v_c_cyber,     'not_started',   0, NULL, NULL, NULL),
    (v_tom,   v_c_fire,      'not_started',   0, NULL, NULL, NULL);

  -- ========== PERFORMANCE REVIEWS ==========
  INSERT INTO performance_reviews (employee_id, reviewer_id, review_period, overall_rating, strengths, areas_for_improvement, goals, status, completed_at) VALUES
    (v_sarah, v_andy, 'H1 2026', 4, 'Strong technical skills, reliable delivery, excellent code quality',        'Could contribute more in team meetings',                   'Lead a tech talk by end of Q3; mentor one junior developer',               'completed',  '2026-07-01T10:00:00Z'),
    (v_james, v_andy, 'H1 2026', 4, 'Creative design thinking, fast iteration, good user empathy',               'Needs to improve stakeholder communication',               'Complete design system v2; run a user research session',                   'completed',  '2026-07-02T11:00:00Z'),
    (v_emma,  v_andy, 'H1 2026', 5, 'Exceptional at employee relations, process improvement champion',          'Could delegate more to build team capacity',               'Implement new onboarding flow; reduce time-to-hire by 15%',               'completed',  '2026-07-03T14:00:00Z'),
    (v_tom,   v_andy, 'H1 2026', 3, 'Good analytical skills, enthusiastic learner',                              'Still ramping up on company processes and tooling',        'Complete all mandatory training; own the monthly variance report',         'in_progress', NULL),
    (v_andy,  v_emma, 'H1 2026', 5, 'Visionary leadership, strong technical judgment, excellent team builder',   'Work-life balance - tendency to overcommit',               'Delegate two standing responsibilities; take full leave allocation',      'completed',  '2026-07-05T09:00:00Z');

  -- ========== ONBOARDING ==========
  INSERT INTO onboarding (user_action, status, firstname, surname, start_date, user_email, job_title, department, employee_number, manager, manager_email, contract_type, location, company_id) VALUES
    ('Joiner', 'complete',    'Sarah',  'Mitchell', '2023-03-15', 'sarah.mitchell@kumonix.com', 'Software Engineer', 'Engineering', 'EMP002', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', v_company_id),
    ('Joiner', 'complete',    'James',  'Patel',    '2023-06-01', 'james.patel@kumonix.com',    'Product Designer',  'Design',      'EMP003', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', v_company_id),
    ('Joiner', 'complete',    'Emma',   'Chen',     '2022-09-01', 'emma.chen@kumonix.com',      'HR Manager',        'HR',          'EMP004', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', v_company_id),
    ('Joiner', 'in_progress', 'Tom',    'Williams', '2024-01-08', 'tom.williams@kumonix.com',   'Finance Analyst',   'Finance',     'EMP005', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', v_company_id),
    ('Joiner', 'new',         'Rachel', 'Green',    '2026-09-01', 'rachel.green@kumonix.com',   'Marketing Manager', 'Marketing',   'EMP006', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', v_company_id);

  -- ========== WORKFLOW TRACKER ==========
  INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, task_description, company_id) VALUES
    ('Sarah Mitchell', 1, 'Pending',  'Leave',   'Approve annual leave',   'sarah.mitchell@kumonix.com', 'andy.jones@kumonix.com', 'Sarah Mitchell has requested 3 days annual leave (28-30 Jul 2026)', v_company_id),
    ('James Patel',    1, 'Pending',  'Leave',   'Approve annual leave',   'james.patel@kumonix.com',    'andy.jones@kumonix.com', 'James Patel has requested 5 days annual leave (1-5 Sep 2026)',      v_company_id),
    ('Tom Williams',   1, 'Pending',  'Leave',   'Approve annual leave',   'tom.williams@kumonix.com',   'andy.jones@kumonix.com', 'Tom Williams has requested 2 days annual leave (18-19 Aug 2026)',   v_company_id),
    ('Sarah Mitchell', 1, 'Pending',  'Expense', 'Approve expense claim',  'sarah.mitchell@kumonix.com', 'andy.jones@kumonix.com', 'Train to London office - £124.00',                                 v_company_id),
    ('James Patel',    1, 'Pending',  'Expense', 'Approve expense claim',  'james.patel@kumonix.com',    'andy.jones@kumonix.com', 'Design software licence - £168.00',                                v_company_id),
    ('Andy Jones',     1, 'Complete', 'Expense', 'Expense claim approved', 'andy.jones@kumonix.com',     'andy.jones@kumonix.com', 'Client lunch meeting - £85.50',                                    v_company_id),
    ('Emma Chen',      1, 'Complete', 'Expense', 'Expense claim approved', 'emma.chen@kumonix.com',      'andy.jones@kumonix.com', 'Team building dinner - £210.75',                                   v_company_id),
    ('Sarah Mitchell', 1, 'Complete', 'Leave',   'Sick leave approved',    'sarah.mitchell@kumonix.com', 'andy.jones@kumonix.com', '2 days sick leave (16-17 Jun 2026)',                               v_company_id);

  -- ========== NOTIFICATIONS ==========
  INSERT INTO notifications (employee_id, title, message, type, is_read, company_id) VALUES
    (v_andy,  'Leave request pending', 'Sarah Mitchell has submitted a leave request for your approval',          'action', false, v_company_id),
    (v_andy,  'Expense claim pending', 'Sarah Mitchell submitted an expense claim (EXP-2026-002) for £124.00',   'action', false, v_company_id),
    (v_andy,  'New kudos received',    'Emma Chen sent you a kudos for mentoring new joiners',                    'info',   true,  v_company_id),
    (v_sarah, 'Leave approved',        'Your sick leave (16-17 Jun) has been approved by Andy Jones',             'info',   true,  v_company_id),
    (v_sarah, 'New kudos received',    'Andy Jones sent you a kudos - great work on the API refactor!',           'info',   false, v_company_id),
    (v_james, 'Mandatory training due','Cyber Security Awareness course is overdue - please complete ASAP',       'alert',  false, v_company_id),
    (v_tom,   'Welcome to Kumonix!',   'Complete your onboarding checklist to get started',                       'info',   true,  v_company_id);

  -- ========== APP SETTINGS ==========
  INSERT INTO app_settings (id, language, financial_year_start_month, country_code, company_id)
  VALUES (1, 'en', 4, 'GB', v_company_id)
  ON CONFLICT (id) DO UPDATE SET language='en', financial_year_start_month=4, country_code='GB', company_id=v_company_id;

  -- ========== USER SETTINGS ==========
  INSERT INTO user_settings (employee_id, language, features_config) VALUES
    (v_andy,  'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
    (v_sarah, 'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
    (v_james, 'de', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
    (v_emma,  'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
    (v_tom,   'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}');

  RETURN 'Demo seed complete: 5 employees, all features populated';
END;
$$;

-- Allow authenticated users to call it (function checks admin role internally)
GRANT EXECUTE ON FUNCTION public.run_demo_seed(uuid) TO authenticated;

-- ============================================================
-- Also update handle_new_sso_user to use domain-based lookup
-- (matches pre-registered companies by email domain, not tenant ID)
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_sso_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id text;
  v_domain text;
  v_company_id uuid;
  v_email text;
  v_is_first_user boolean;
BEGIN
  v_email := NEW.email;
  v_domain := split_part(v_email, '@', 2);

  -- Extract Microsoft tenant ID
  v_tenant_id := COALESCE(
    NEW.raw_user_meta_data -> 'custom_claims' ->> 'tid',
    NEW.raw_app_meta_data ->> 'provider_id'
  );

  -- Look up company by domain (must be pre-registered and active)
  SELECT id INTO v_company_id
  FROM companies
  WHERE domain = v_domain AND is_active = true;

  -- If no matching company, user is not allowed — skip silently
  -- (AuthContext will show AccessDenied)
  IF v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Update the company's tenant ID if it was a placeholder
  IF v_tenant_id IS NOT NULL AND v_tenant_id != '' THEN
    UPDATE companies
    SET microsoft_tenant_id = v_tenant_id
    WHERE id = v_company_id
      AND (microsoft_tenant_id IS NULL OR microsoft_tenant_id = '' OR microsoft_tenant_id = 'placeholder-tenant-id');
  END IF;

  -- Check if this is the first user for this company
  SELECT NOT EXISTS (
    SELECT 1 FROM company_users WHERE company_id = v_company_id
  ) INTO v_is_first_user;

  -- Create company_users link
  INSERT INTO company_users (auth_user_id, company_id, role)
  VALUES (
    NEW.id,
    v_company_id,
    CASE WHEN v_is_first_user THEN 'admin' ELSE 'employee' END
  )
  ON CONFLICT (auth_user_id, company_id) DO NOTHING;

  RETURN NEW;
END;
$$;
