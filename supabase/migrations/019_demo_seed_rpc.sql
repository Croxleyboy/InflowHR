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
  -- Kumonix IDs
  v_company_id uuid := '11111111-1111-1111-1111-111111111111';
  v_andy uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_sarah uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_james uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_emma uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_tom uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  -- Move2Modern IDs
  v_m2m_id uuid := '22222222-2222-2222-2222-222222222222';
  v_m2m_andy  uuid := 'ff000000-0000-0000-0000-000000000000';
  v_m2m_sarah uuid := 'ff000001-0000-0000-0000-000000000001';
  v_m2m_james uuid := 'ff000002-0000-0000-0000-000000000002';
  v_m2m_priya uuid := 'ff000003-0000-0000-0000-000000000003';
  v_m2m_tom   uuid := 'ff000004-0000-0000-0000-000000000004';
  v_m2m_lucy  uuid := 'ff000005-0000-0000-0000-000000000005';

  v_tenant_id text;

  -- Kumonix leave types
  v_lt_annual bigint;
  v_lt_sick bigint;

  -- Move2Modern leave types
  v_m2m_lt_annual bigint;
  v_m2m_lt_sick bigint;

  -- Kumonix expense claim IDs
  v_claim1 bigint;
  v_claim2 bigint;
  v_claim3 bigint;
  v_claim4 bigint;
  v_claim5 bigint;

  -- Move2Modern expense claim IDs
  v_m2m_claim1 bigint;
  v_m2m_claim2 bigint;
  v_m2m_claim3 bigint;
  v_m2m_claim4 bigint;
  v_m2m_claim5 bigint;

  -- Leave request IDs (for workflow_tracker approval_id)
  v_lr_sarah_annual bigint;
  v_lr_james_annual bigint;
  v_lr_tom_annual bigint;
  v_m2m_lr_james bigint;
  v_m2m_lr_priya bigint;
  v_m2m_lr_lucy bigint;

  -- Benefits
  v_ben_health bigint;
  v_ben_cycle bigint;
  v_ben_pension bigint;
  v_ben_gym bigint;
  v_ben_mental bigint;

  -- 1:1 Meetings
  v_mtg1 bigint;
  v_mtg2 bigint;
  v_mtg3 bigint;
  v_mtg4 bigint;
  v_mtg5 bigint;
  v_mtg6 bigint;
  v_mtg7 bigint;

  -- Courses
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
  -- Temporarily bypass RLS so cross-company deletes succeed
  ALTER TABLE one_to_one_comments DISABLE ROW LEVEL SECURITY;
  ALTER TABLE one_to_one_meetings DISABLE ROW LEVEL SECURITY;

  -- pg_safeupdate requires a WHERE clause on every DELETE
  DELETE FROM one_to_one_comments WHERE id IS NOT NULL;
  DELETE FROM one_to_one_meetings WHERE id IS NOT NULL;
  DELETE FROM workflow_tracker  WHERE id IS NOT NULL;
  DELETE FROM notifications     WHERE id IS NOT NULL;
  DELETE FROM timesheets        WHERE id IS NOT NULL;
  DELETE FROM expense_line_items WHERE id IS NOT NULL;
  DELETE FROM expense_claims    WHERE id IS NOT NULL;
  DELETE FROM leave_requests    WHERE id IS NOT NULL;
  DELETE FROM leave_balances    WHERE id IS NOT NULL;
  DELETE FROM course_enrolments WHERE id IS NOT NULL;
  DELETE FROM employee_benefits WHERE id IS NOT NULL;
  DELETE FROM performance_reviews WHERE id IS NOT NULL;
  DELETE FROM kudos             WHERE id IS NOT NULL;
  DELETE FROM payslips          WHERE id IS NOT NULL;
  DELETE FROM onboarding        WHERE id IS NOT NULL;
  DELETE FROM announcements     WHERE id IS NOT NULL;
  DELETE FROM user_settings     WHERE employee_id IS NOT NULL;
  DELETE FROM app_settings      WHERE id IS NOT NULL;
  DELETE FROM company_users     WHERE company_id IS NOT NULL;
  DELETE FROM employees         WHERE id IS NOT NULL;
  DELETE FROM leave_types       WHERE id IS NOT NULL;
  DELETE FROM benefits          WHERE id IS NOT NULL;
  DELETE FROM courses           WHERE id IS NOT NULL;
  DELETE FROM companies         WHERE id IS NOT NULL;

  -- Re-enable RLS
  ALTER TABLE one_to_one_meetings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE one_to_one_comments ENABLE ROW LEVEL SECURITY;

  -- ================================================================
  --  KUMONIX
  -- ================================================================

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

  SELECT id INTO v_lr_sarah_annual FROM leave_requests WHERE employee_id=v_sarah AND start_date='2026-07-28' LIMIT 1;
  SELECT id INTO v_lr_james_annual FROM leave_requests WHERE employee_id=v_james AND start_date='2026-09-01' LIMIT 1;
  SELECT id INTO v_lr_tom_annual   FROM leave_requests WHERE employee_id=v_tom   AND start_date='2026-08-18' LIMIT 1;

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

  -- ========== BENEFITS (shared across companies) ==========
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

  -- ========== COURSES (shared across companies) ==========
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
  INSERT INTO onboarding (user_action, status, firstname, surname, start_date, user_email, job_title, department, employee_number, manager, manager_email, contract_type, location, date_of_birth, telephone, personal_email, address_line_1, address_line_2, address_line_3, emergency_contact_number, gender, nationality, is_complete, first_day, first_week, first_month, feedback, three_month, elearning, completed_on, employee_id, company_id) VALUES
    ('Joiner', 'complete', 'Andy', 'Jones', '2022-01-10', 'andy.jones@kumonix.com', 'Head of IT', 'IT', 'EMP001', NULL, NULL, 'standard persona', 'London', '1985-06-15', '+44 7700 100001', 'andy.personal@gmail.com', '42 Croxley Road', 'Watford', 'WD3 4QY', '+44 7700 200001', 'Male', 'British', true, true, true, true, true, true, true, '2022-04-10', v_andy, v_company_id);

  INSERT INTO onboarding (user_action, status, firstname, surname, start_date, user_email, job_title, department, employee_number, manager, manager_email, contract_type, location, is_complete, first_day, first_week, first_month, feedback, three_month, elearning, completed_on, employee_id, company_id) VALUES
    ('Joiner', 'complete', 'Sarah',  'Mitchell', '2023-03-15', 'sarah.mitchell@kumonix.com', 'Software Engineer', 'Engineering', 'EMP002', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', true, true, true, true, true, true, true, '2023-06-15', v_sarah, v_company_id),
    ('Joiner', 'complete', 'James',  'Patel',    '2023-06-01', 'james.patel@kumonix.com',    'Product Designer',  'Design',      'EMP003', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', true, true, true, true, true, true, true, '2023-09-01', v_james, v_company_id),
    ('Joiner', 'complete', 'Emma',   'Chen',     '2022-09-01', 'emma.chen@kumonix.com',      'HR Manager',        'HR',          'EMP004', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', true, true, true, true, true, true, true, '2022-12-01', v_emma,  v_company_id),
    ('Joiner', 'complete', 'Tom',    'Williams', '2024-01-08', 'tom.williams@kumonix.com',   'Finance Analyst',   'Finance',     'EMP005', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', true, true, true, true, true, true, true, '2024-04-08', v_tom,   v_company_id),
    ('Joiner', 'new',      'Rachel', 'Green',    '2026-09-01', 'rachel.green@kumonix.com',   'Marketing Manager', 'Marketing',   'EMP006', 'Andy Jones', 'andy.jones@kumonix.com', 'standard persona', 'London', false, false, false, false, false, false, false, NULL, NULL, v_company_id);

  -- ========== TIMESHEETS ==========
  INSERT INTO timesheets (employee_id, location, customer, role, date, start_time, end_time, status, submitted_at, company_id) VALUES
    (v_andy,  'Head Office', NULL,           'IT',          '2026-07-21', '09:00', '17:30', 'approved',  '2026-07-21T17:30:00Z', v_company_id),
    (v_andy,  'Home',        'Acme Corp',    'IT',          '2026-07-22', '08:30', '17:00', 'approved',  '2026-07-22T17:00:00Z', v_company_id),
    (v_andy,  'Customer Site','Acme Corp',   'IT',          '2026-07-23', '09:00', '18:00', 'pending',   '2026-07-23T18:00:00Z', v_company_id),
    (v_sarah, 'Head Office', NULL,           'Engineering', '2026-07-21', '09:00', '17:00', 'approved',  '2026-07-21T17:00:00Z', v_company_id),
    (v_sarah, 'Home',        NULL,           'Engineering', '2026-07-22', '09:30', '18:00', 'pending',   '2026-07-22T18:00:00Z', v_company_id),
    (v_james, 'Head Office', NULL,           'Design',      '2026-07-21', '10:00', '18:30', 'approved',  '2026-07-21T18:30:00Z', v_company_id),
    (v_james, 'Home',        NULL,           'Design',      '2026-07-22', '09:00', '17:00', 'draft',     NULL,                   v_company_id),
    (v_tom,   'Head Office', NULL,           'Finance',     '2026-07-21', '08:00', '16:30', 'pending',   '2026-07-21T16:30:00Z', v_company_id);

  -- ========== WORKFLOW TRACKER ==========
  INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, task_description, approval_id, company_id) VALUES
    ('Sarah Mitchell', 1, 'Pending',  'Leave',   'Approve annual leave',   'sarah.mitchell@kumonix.com', 'andy.jones@kumonix.com', 'Annual Leave - 28/07/2026 to 30/07/2026 (3 days)', v_lr_sarah_annual, v_company_id),
    ('James Patel',    1, 'Pending',  'Leave',   'Approve annual leave',   'james.patel@kumonix.com',    'andy.jones@kumonix.com', 'Annual Leave - 01/09/2026 to 05/09/2026 (5 days)',  v_lr_james_annual, v_company_id),
    ('Tom Williams',   1, 'Pending',  'Leave',   'Approve annual leave',   'tom.williams@kumonix.com',   'andy.jones@kumonix.com', 'Annual Leave - 18/08/2026 to 19/08/2026 (2 days)',  v_lr_tom_annual,   v_company_id),
    ('Sarah Mitchell', 1, 'Pending',  'Expense', 'Approve expense claim',  'sarah.mitchell@kumonix.com', 'andy.jones@kumonix.com', 'Train to London office - £124.00',                  v_claim2,          v_company_id),
    ('James Patel',    1, 'Pending',  'Expense', 'Approve expense claim',  'james.patel@kumonix.com',    'andy.jones@kumonix.com', 'Design software licence - £168.00',                 v_claim3,          v_company_id),
    ('Andy Jones',     1, 'Complete', 'Expense', 'Expense claim approved', 'andy.jones@kumonix.com',     'andy.jones@kumonix.com', 'Client lunch meeting - £85.50',                     v_claim1,          v_company_id),
    ('Emma Chen',      1, 'Complete', 'Expense', 'Expense claim approved', 'emma.chen@kumonix.com',      'andy.jones@kumonix.com', 'Team building dinner - £210.75',                    v_claim5,          v_company_id),
    ('Sarah Mitchell', 1, 'Complete', 'Leave',   'Sick leave approved',    'sarah.mitchell@kumonix.com', 'andy.jones@kumonix.com', '2 days sick leave (16-17 Jun 2026)',                NULL,              v_company_id);

  -- ========== NOTIFICATIONS ==========
  INSERT INTO notifications (employee_id, title, message, type, is_read, company_id) VALUES
    (v_andy,  'Leave request pending', 'Sarah Mitchell has submitted a leave request for your approval',          'action', false, v_company_id),
    (v_andy,  'Expense claim pending', 'Sarah Mitchell submitted an expense claim (EXP-2026-002) for £124.00',   'action', false, v_company_id),
    (v_andy,  'New kudos received',    'Emma Chen sent you a kudos for mentoring new joiners',                    'info',   true,  v_company_id),
    (v_sarah, 'Leave approved',        'Your sick leave (16-17 Jun) has been approved by Andy Jones',             'info',   true,  v_company_id),
    (v_sarah, 'New kudos received',    'Andy Jones sent you a kudos - great work on the API refactor!',           'info',   false, v_company_id),
    (v_james, 'Mandatory training due','Cyber Security Awareness course is overdue - please complete ASAP',       'alert',  false, v_company_id),
    (v_tom,   'Onboarding complete',   'All onboarding steps have been completed. Welcome to the team!',          'info',   true,  v_company_id);

  -- ========== 1:1 MEETINGS ==========
  INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, summary, completed_at, company_id) VALUES
    (v_andy, v_sarah, '2026-06-15', '10:00', 'completed', 'Discussed progress on API refactor. Sarah is ahead of schedule. Agreed to extend scope to include auth endpoints. Career goal: Sarah wants to move into tech lead role by year end.', '2026-06-15 11:00:00+00', v_company_id)
  RETURNING id INTO v_mtg1;
  INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, summary, completed_at, company_id) VALUES
    (v_andy, v_sarah, '2026-07-13', '10:00', 'completed', 'Reviewed Q2 objectives — all on track. Talked about conference attendance in Sept. Sarah to prepare a talk proposal for internal tech day.', '2026-07-13 11:00:00+00', v_company_id)
  RETURNING id INTO v_mtg2;
  INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, summary, completed_at, company_id) VALUES
    (v_andy, v_james, '2026-06-20', '14:00', 'completed', 'James demoed new design system components. Great progress. Discussed workload balance — agreed to defer the mobile redesign to Q4.', '2026-06-20 15:00:00+00', v_company_id)
  RETURNING id INTO v_mtg3;
  INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, summary, completed_at, company_id) VALUES
    (v_andy, v_emma,  '2026-07-01', '09:30', 'completed', 'Reviewed onboarding improvements. Emma proposed automating the offer letter flow. Approved budget for HR software evaluation.', '2026-07-01 10:30:00+00', v_company_id),
    (v_andy, v_tom,   '2026-07-20', '11:00', 'completed', 'Tom settling in well. Discussed finance reporting requirements. Agreed to shadow payroll process next month.', '2026-07-20 12:00:00+00', v_company_id),
    (v_andy, v_sarah, '2026-08-03', '10:00', 'pending',   NULL, NULL, v_company_id),
    (v_andy, v_james, '2026-08-05', '14:00', 'pending',   NULL, NULL, v_company_id);

  INSERT INTO one_to_one_comments (meeting_id, author_id, body, company_id) VALUES
    (v_mtg1, v_sarah, 'Thanks for the feedback on the auth endpoint scope. I''ll update the sprint plan accordingly.', v_company_id),
    (v_mtg2, v_sarah, 'Conference talk proposal submitted — fingers crossed!', v_company_id),
    (v_mtg3, v_james, 'Agreed on deferring mobile redesign. Will focus on component library documentation instead.', v_company_id);

  -- Set Andy's manager to Emma (after all employees exist)
  UPDATE employees SET manager_id = v_emma WHERE id = v_andy;

  -- 1:1 meetings where Andy is the EMPLOYEE (Emma as his manager for HR/performance reviews)
  INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, summary, completed_at, company_id) VALUES
    (v_emma, v_andy, '2026-06-10', '09:00', 'completed', 'Quarterly performance review. Andy is managing team growth well. Discussed succession planning for IT dept. Agreed to formalise the mentoring programme by Q3.', '2026-06-10 10:00:00+00', v_company_id)
  RETURNING id INTO v_mtg4;
  INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, summary, completed_at, company_id) VALUES
    (v_emma, v_andy, '2026-07-08', '09:00', 'completed', 'Mid-year review. Headcount approved for two new hires in Engineering. Andy to draft JDs by end of month. Discussed budget reallocation for cloud infrastructure.', '2026-07-08 10:00:00+00', v_company_id)
  RETURNING id INTO v_mtg5;
  INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, summary, completed_at, company_id) VALUES
    (v_emma, v_andy, '2026-07-22', '09:00', 'completed', 'Catch-up on hiring pipeline. Three strong candidates shortlisted for Senior Engineer role. Andy raised concern about on-call rota coverage during August holidays.', '2026-07-22 10:00:00+00', v_company_id)
  RETURNING id INTO v_mtg6;
  -- Pending meeting for Andy (shows in notifications)
  INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, company_id) VALUES
    (v_emma, v_andy, '2026-08-12', '09:00', 'pending', v_company_id)
  RETURNING id INTO v_mtg7;

  INSERT INTO one_to_one_comments (meeting_id, author_id, body, company_id) VALUES
    (v_mtg4, v_emma, 'Great discussion. Let me know when the mentoring programme doc is ready for review.', v_company_id),
    (v_mtg4, v_andy, 'Will have the mentoring framework drafted by end of June.', v_company_id),
    (v_mtg5, v_emma, 'JD templates shared in the HR folder — feel free to adapt for the Engineering roles.', v_company_id),
    (v_mtg5, v_andy, 'Thanks Emma, JDs drafted and shared for your review.', v_company_id),
    (v_mtg6, v_emma, 'Good point on on-call coverage. I''ll flag this with the wider leadership team.', v_company_id);

  -- Workflow tracker notification for Andy's pending meeting
  INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, task_description, approval_id, company_id) VALUES
    ('Andy Jones', 1, 'Pending', 'Meeting', '1:1 meeting scheduled', 'andy.jones@kumonix.com', 'andy.jones@kumonix.com', 'Emma Chen has scheduled a 1:1 meeting with you on Tue, 12 Aug 2026 at 09:00', v_mtg7, v_company_id);

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

  -- ================================================================
  --  MOVE2MODERN
  -- ================================================================

  INSERT INTO companies (id, name, microsoft_tenant_id, domain, is_active)
  VALUES (v_m2m_id, 'Move2Modern', 'placeholder-tenant-id', 'move2modern.co.uk', true);

  -- ========== EMPLOYEES ==========
  INSERT INTO employees (id, employee_number, first_name, last_name, email, job_title, department, manager_id, start_date, phone, is_admin, is_active, can_post_notifications, company_id) VALUES
    (v_m2m_andy,  'M2M000', 'Andy',  'Jones',     'andy@move2modern.co.uk',            'Managing Director',              'Leadership', NULL,          '2024-01-15', '+44 7700 200000', true,  true, true,  v_m2m_id),
    (v_m2m_sarah, 'M2M001', 'Sarah', 'Mitchell',  'sarah.mitchell@move2modern.co.uk',  'Head of Digital Transformation', 'Technology', v_m2m_andy,    '2024-03-01', '+44 7700 200001', false, true, true,  v_m2m_id),
    (v_m2m_james, 'M2M002', 'James', 'Cooper',    'james.cooper@move2modern.co.uk',    'Senior Cloud Engineer',          'Technology', v_m2m_sarah,   '2024-06-15', '+44 7700 200002', false, true, false, v_m2m_id),
    (v_m2m_priya, 'M2M003', 'Priya', 'Patel',     'priya.patel@move2modern.co.uk',     'UX Design Lead',                'Design',     v_m2m_sarah,   '2024-09-01', '+44 7700 200003', false, true, false, v_m2m_id),
    (v_m2m_tom,   'M2M004', 'Tom',   'Henderson', 'tom.henderson@move2modern.co.uk',   'Project Manager',                'Delivery',   v_m2m_andy,    '2025-01-13', '+44 7700 200004', false, true, false, v_m2m_id),
    (v_m2m_lucy,  'M2M005', 'Lucy',  'Chen',      'lucy.chen@move2modern.co.uk',       'Business Analyst',               'Delivery',   v_m2m_tom,     '2025-04-07', '+44 7700 200005', false, true, false, v_m2m_id);

  -- ========== COMPANY_USERS (super admin linked to Move2Modern) ==========
  INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
  VALUES (p_auth_uid, v_m2m_id, v_m2m_andy, 'admin', true);

  -- ========== LEAVE TYPES ==========
  INSERT INTO leave_types (name, default_allowance, colour, is_active, company_id) VALUES
    ('Annual Leave',    25, '#4caf50', true, v_m2m_id),
    ('Sick Leave',      10, '#f44336', true, v_m2m_id),
    ('Parental Leave',  14, '#9c27b0', true, v_m2m_id),
    ('Compassionate',    5, '#607d8b', true, v_m2m_id),
    ('Work From Home', 999, '#2196f3', true, v_m2m_id);

  SELECT id INTO v_m2m_lt_annual FROM leave_types WHERE name='Annual Leave' AND company_id=v_m2m_id LIMIT 1;
  SELECT id INTO v_m2m_lt_sick FROM leave_types WHERE name='Sick Leave' AND company_id=v_m2m_id LIMIT 1;

  -- ========== LEAVE BALANCES ==========
  INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over, company_id) VALUES
    (v_m2m_andy,  v_m2m_lt_annual, 2026, 30, 3, 5, v_m2m_id),
    (v_m2m_andy,  v_m2m_lt_sick,   2026, 10, 0, 0, v_m2m_id),
    (v_m2m_sarah, v_m2m_lt_annual, 2026, 28, 4, 3, v_m2m_id),
    (v_m2m_sarah, v_m2m_lt_sick,   2026, 10, 0, 0, v_m2m_id),
    (v_m2m_james, v_m2m_lt_annual, 2026, 25, 6, 0, v_m2m_id),
    (v_m2m_james, v_m2m_lt_sick,   2026, 10, 1, 0, v_m2m_id),
    (v_m2m_priya, v_m2m_lt_annual, 2026, 25, 3, 0, v_m2m_id),
    (v_m2m_priya, v_m2m_lt_sick,   2026, 10, 0, 0, v_m2m_id),
    (v_m2m_tom,   v_m2m_lt_annual, 2026, 25, 5, 0, v_m2m_id),
    (v_m2m_tom,   v_m2m_lt_sick,   2026, 10, 2, 0, v_m2m_id),
    (v_m2m_lucy,  v_m2m_lt_annual, 2026, 25, 2, 0, v_m2m_id),
    (v_m2m_lucy,  v_m2m_lt_sick,   2026, 10, 0, 0, v_m2m_id);

  -- ========== LEAVE REQUESTS ==========
  INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, status, reason, approved_by, company_id) VALUES
    (v_m2m_sarah, v_m2m_lt_annual, '2026-08-11', '2026-08-15', 5, 'approved', 'Summer break',            NULL,          v_m2m_id),
    (v_m2m_james, v_m2m_lt_annual, '2026-09-08', '2026-09-12', 5, 'pending',  'AWS re:Invent travel',    NULL,          v_m2m_id),
    (v_m2m_james, v_m2m_lt_sick,   '2026-06-23', '2026-06-23', 1, 'approved', 'Doctor appointment',      v_m2m_sarah,   v_m2m_id),
    (v_m2m_priya, v_m2m_lt_annual, '2026-10-20', '2026-10-24', 5, 'pending',  'Diwali celebrations',     NULL,          v_m2m_id),
    (v_m2m_tom,   v_m2m_lt_annual, '2026-12-22', '2026-12-31', 7, 'approved', 'Christmas & New Year',    v_m2m_sarah,   v_m2m_id),
    (v_m2m_lucy,  v_m2m_lt_annual, '2026-08-25', '2026-08-26', 2, 'pending',  'Personal appointment',    NULL,          v_m2m_id);

  SELECT id INTO v_m2m_lr_james FROM leave_requests WHERE employee_id=v_m2m_james AND start_date='2026-09-08' LIMIT 1;
  SELECT id INTO v_m2m_lr_priya FROM leave_requests WHERE employee_id=v_m2m_priya AND start_date='2026-10-20' LIMIT 1;
  SELECT id INTO v_m2m_lr_lucy  FROM leave_requests WHERE employee_id=v_m2m_lucy  AND start_date='2026-08-25' LIMIT 1;

  -- ========== EXPENSE CLAIMS ==========
  INSERT INTO expense_claims (employee_id, reference_number, title, description, amount, status, category, submitted_at, start_date, end_date, company_id)
  VALUES
    (v_m2m_sarah, 'M2M-EXP-001', 'Client workshop catering',  'Workshop lunch for 12',        195.00, 'approved',  'Meals',    '2026-07-05T09:00:00Z', '2026-07-05', '2026-07-05', v_m2m_id),
    (v_m2m_james, 'M2M-EXP-002', 'AWS certification exam',    'Solutions Architect Pro',       300.00, 'approved',  'Training', '2026-06-20T11:00:00Z', '2026-06-20', '2026-06-20', v_m2m_id),
    (v_m2m_priya, 'M2M-EXP-003', 'Design conference ticket',  'UX London 2026',               450.00, 'pending',   'Training', '2026-07-12T10:00:00Z', '2026-07-12', '2026-07-12', v_m2m_id),
    (v_m2m_tom,   'M2M-EXP-004', 'Train to client site',      'Manchester return',              89.50, 'submitted', 'Travel',   '2026-07-15T08:00:00Z', '2026-07-15', '2026-07-15', v_m2m_id),
    (v_m2m_lucy,  'M2M-EXP-005', 'Office stationery',         'Notebooks and whiteboard pens',  34.99, 'draft',     'Office Supplies', NULL,             '2026-07-18', '2026-07-18', v_m2m_id);

  SELECT id INTO v_m2m_claim1 FROM expense_claims WHERE reference_number='M2M-EXP-001' LIMIT 1;
  SELECT id INTO v_m2m_claim2 FROM expense_claims WHERE reference_number='M2M-EXP-002' LIMIT 1;
  SELECT id INTO v_m2m_claim3 FROM expense_claims WHERE reference_number='M2M-EXP-003' LIMIT 1;
  SELECT id INTO v_m2m_claim4 FROM expense_claims WHERE reference_number='M2M-EXP-004' LIMIT 1;
  SELECT id INTO v_m2m_claim5 FROM expense_claims WHERE reference_number='M2M-EXP-005' LIMIT 1;

  -- ========== EXPENSE LINE ITEMS ==========
  INSERT INTO expense_line_items (expense_claim_id, title, expense_type, description, date_of_purchase, amount, company_id) VALUES
    (v_m2m_claim1, 'Catering order',         'Meals',           'Sandwich platters & drinks',  '2026-07-05', 195.00, v_m2m_id),
    (v_m2m_claim2, 'AWS exam fee',           'Training',        'SAP-C02 exam voucher',        '2026-06-20', 300.00, v_m2m_id),
    (v_m2m_claim3, 'Conference ticket',      'Training',        'UX London early bird',        '2026-07-12', 450.00, v_m2m_id),
    (v_m2m_claim4, 'Train outbound',         'Travel',          'Euston to Piccadilly',        '2026-07-15',  44.75, v_m2m_id),
    (v_m2m_claim4, 'Train return',           'Travel',          'Piccadilly to Euston',        '2026-07-15',  44.75, v_m2m_id),
    (v_m2m_claim5, 'Stationery',             'Office Supplies', 'WHSmith purchase',            '2026-07-18',  34.99, v_m2m_id);

  -- ========== PAYSLIPS (Apr-Jul 2026, all 5 employees) ==========
  INSERT INTO payslips (employee_id, reference_number, pay_period_start, pay_period_end, gross_pay, tax, national_insurance, pension, other_deductions, net_pay, payment_date, status, tax_code, annual_salary, payroll_id, bank_account, payroll_office, overtime, adjustments, monthly_deductions, company_id)
  SELECT
    e.id,
    'M2M-PAY-2026-' || lpad(m.mon::text, 2, '0') || '-' || left(e.first_name,1) || left(e.last_name,1),
    make_date(2026, m.mon, 1),
    (make_date(2026, m.mon, 1) + interval '1 month - 1 day')::date,
    round(e.annual_sal / 12, 2),
    round(e.annual_sal / 12 * 0.20, 2),
    round(e.annual_sal / 12 * 0.12, 2),
    round(e.annual_sal / 12 * 0.05, 2),
    0,
    round(e.annual_sal / 12 * 0.63, 2),
    (make_date(2026, m.mon, 1) + interval '1 month - 4 day')::date,
    CASE WHEN m.mon = 7 THEN 'processed' ELSE 'paid' END,
    '1257L',
    e.annual_sal,
    'M2M-' || lpad(e.emp_idx::text, 3, '0'),
    '****' || (2000 + e.emp_idx * 1111)::text,
    'London', 0, 0, 0, v_m2m_id
  FROM (VALUES
    (v_m2m_andy,  'Andy',  'Jones',     85000, 0),
    (v_m2m_sarah, 'Sarah', 'Mitchell',  72000, 1),
    (v_m2m_james, 'James', 'Cooper',    58000, 2),
    (v_m2m_priya, 'Priya', 'Patel',     52000, 3),
    (v_m2m_tom,   'Tom',   'Henderson', 48000, 4),
    (v_m2m_lucy,  'Lucy',  'Chen',      42000, 5)
  ) AS e(id, first_name, last_name, annual_sal, emp_idx)
  CROSS JOIN (VALUES (4),(5),(6),(7)) AS m(mon);

  -- ========== KUDOS ==========
  INSERT INTO kudos (from_employee_id, to_employee_id, message, category, recognition_type, badge, quality, is_broadcast, like_count, liked_by, company_id) VALUES
    (v_m2m_sarah, v_m2m_james, 'Fantastic work migrating us to the new AWS architecture - zero downtime!',   'innovation',     'recognition', 'star',   'Innovation',           false, 3, ARRAY[v_m2m_priya, v_m2m_tom, v_m2m_lucy], v_m2m_id),
    (v_m2m_james, v_m2m_priya, 'The new design system components are beautiful. Love the accessibility work!','teamwork',       'recognition', 'heart',  'Teamwork',             false, 2, ARRAY[v_m2m_sarah, v_m2m_lucy],             v_m2m_id),
    (v_m2m_priya, v_m2m_sarah, 'Thank you for championing our UX research budget - it made a real difference!','leadership',    'recognition', 'trophy', 'Leadership',           false, 2, ARRAY[v_m2m_james, v_m2m_tom],              v_m2m_id),
    (v_m2m_tom,   v_m2m_lucy,  'Great stakeholder management on the Council project - client loved the demos!','customer_focus','recognition', 'gem',    'Attention to Detail',  false, 1, ARRAY[v_m2m_sarah],                         v_m2m_id),
    (v_m2m_lucy,  NULL,        'Team pizza Friday this week - see you all at 12:30!',                          NULL,             'broadcast',   NULL,     NULL,                   true,  3, ARRAY[v_m2m_sarah, v_m2m_james, v_m2m_tom], v_m2m_id);

  -- ========== ANNOUNCEMENTS ==========
  INSERT INTO announcements (title, body, author_id, is_pinned, published_at, submitted_by_name, company_id) VALUES
    ('Q3 Strategy Review',             'Join us on August 5th at 10am for the quarterly strategy review. We will discuss client pipeline, hiring plans, and technology roadmap.', v_m2m_sarah, true,  '2026-07-21T09:00:00Z', 'Sarah Mitchell', v_m2m_id),
    ('Office Move Update',             'Our new office at WeWork Moorgate is confirmed for September 1st. Packing boxes will be distributed next week.',                          v_m2m_sarah, false, '2026-07-18T10:00:00Z', 'Sarah Mitchell', v_m2m_id),
    ('AWS Partnership Certified',      'Exciting news - Move2Modern is now an AWS Advanced Consulting Partner! Huge thanks to the technology team for making this happen.',        v_m2m_sarah, false, '2026-07-10T14:00:00Z', 'Sarah Mitchell', v_m2m_id),
    ('Welcome Lucy Chen!',             'Please welcome Lucy Chen to the Delivery team as our new Business Analyst. Lucy joins us from Deloitte Digital.',                          v_m2m_tom,   false, '2025-04-07T09:00:00Z', 'Tom Henderson',  v_m2m_id);

  -- ========== EMPLOYEE BENEFITS (Move2Modern) ==========
  INSERT INTO employee_benefits (employee_id, benefit_id, status) VALUES
    (v_m2m_andy,  v_ben_health,  'active'), (v_m2m_andy,  v_ben_pension, 'active'),
    (v_m2m_sarah, v_ben_health,  'active'), (v_m2m_sarah, v_ben_pension, 'active'),
    (v_m2m_james, v_ben_health,  'active'), (v_m2m_james, v_ben_pension, 'active'), (v_m2m_james, v_ben_gym, 'active'),
    (v_m2m_priya, v_ben_pension, 'active'), (v_m2m_priya, v_ben_cycle,   'active'),
    (v_m2m_tom,   v_ben_pension, 'active'), (v_m2m_tom,   v_ben_mental,  'active'),
    (v_m2m_lucy,  v_ben_pension, 'active'), (v_m2m_lucy,  v_ben_mental,  'pending');

  -- ========== COURSE ENROLMENTS (Move2Modern) ==========
  INSERT INTO course_enrolments (employee_id, course_id, status, progress_pct, started_at, completed_at, score) VALUES
    (v_m2m_andy,  v_c_gdpr,  'completed',   100, '2026-02-10T10:00:00Z', '2026-02-10T10:42:00Z', 90),
    (v_m2m_andy,  v_c_cyber, 'completed',   100, '2026-02-15T14:00:00Z', '2026-02-15T14:28:00Z', 93),
    (v_m2m_andy,  v_c_fire,  'completed',   100, '2026-03-01T09:00:00Z', '2026-03-01T09:18:00Z', 88),
    (v_m2m_sarah, v_c_gdpr,  'completed',   100, '2026-03-10T10:00:00Z', '2026-03-10T10:45:00Z', 94),
    (v_m2m_sarah, v_c_cyber, 'completed',   100, '2026-03-15T14:00:00Z', '2026-03-15T14:30:00Z', 91),
    (v_m2m_sarah, v_c_fire,  'completed',   100, '2026-04-01T09:00:00Z', '2026-04-01T09:20:00Z', 88),
    (v_m2m_james, v_c_gdpr,  'completed',   100, '2026-07-01T10:00:00Z', '2026-07-01T10:42:00Z', 87),
    (v_m2m_james, v_c_cyber, 'completed',   100, '2026-07-05T14:00:00Z', '2026-07-05T14:28:00Z', 96),
    (v_m2m_james, v_c_fire,  'in_progress',  50, '2026-07-18T09:00:00Z', NULL, NULL),
    (v_m2m_priya, v_c_gdpr,  'completed',   100, '2026-05-01T10:00:00Z', '2026-05-01T10:40:00Z', 90),
    (v_m2m_priya, v_c_cyber, 'in_progress',  60, '2026-07-15T14:00:00Z', NULL, NULL),
    (v_m2m_priya, v_c_fire,  'not_started',   0, NULL, NULL, NULL),
    (v_m2m_tom,   v_c_gdpr,  'completed',   100, '2026-04-15T10:00:00Z', '2026-04-15T10:48:00Z', 82),
    (v_m2m_tom,   v_c_cyber, 'completed',   100, '2026-04-20T14:00:00Z', '2026-04-20T14:25:00Z', 85),
    (v_m2m_tom,   v_c_fire,  'completed',   100, '2026-05-01T09:00:00Z', '2026-05-01T09:18:00Z', 92),
    (v_m2m_tom,   v_c_agile, 'completed',   100, '2026-06-01T10:00:00Z', '2026-06-01T10:38:00Z', 95),
    (v_m2m_lucy,  v_c_gdpr,  'in_progress',  40, '2026-07-20T10:00:00Z', NULL, NULL),
    (v_m2m_lucy,  v_c_cyber, 'not_started',   0, NULL, NULL, NULL),
    (v_m2m_lucy,  v_c_fire,  'not_started',   0, NULL, NULL, NULL);

  -- ========== PERFORMANCE REVIEWS ==========
  INSERT INTO performance_reviews (employee_id, reviewer_id, review_period, overall_rating, strengths, areas_for_improvement, goals, status, completed_at) VALUES
    (v_m2m_james, v_m2m_sarah, 'H1 2026', 5, 'Outstanding cloud architecture skills, strong DevOps practices',       'Could improve documentation of technical decisions',       'Achieve AWS DevOps Professional cert; establish architecture decision records', 'completed',   '2026-07-01T10:00:00Z'),
    (v_m2m_priya, v_m2m_sarah, 'H1 2026', 4, 'Excellent design thinking, strong accessibility focus',                 'Could run more user testing sessions independently',       'Launch design system v1; conduct 3 user research rounds',                       'completed',   '2026-07-02T11:00:00Z'),
    (v_m2m_tom,   v_m2m_sarah, 'H1 2026', 4, 'Great stakeholder management, reliable delivery',                       'Could improve risk identification early in projects',      'Complete PRINCE2 Agile cert; implement project risk register template',          'completed',   '2026-07-03T14:00:00Z'),
    (v_m2m_lucy,  v_m2m_tom,   'H1 2026', 3, 'Good analytical skills, picks up domain knowledge quickly',             'Still new to consultancy environment, building confidence','Complete all mandatory training; shadow 2 client workshops',                     'in_progress', NULL);

  -- ========== ONBOARDING ==========
  INSERT INTO onboarding (user_action, status, firstname, surname, start_date, user_email, job_title, department, employee_number, manager, manager_email, contract_type, location, is_complete, first_day, first_week, first_month, feedback, three_month, elearning, completed_on, employee_id, company_id) VALUES
    ('Joiner', 'complete', 'Andy',  'Jones',     '2024-01-15', 'andy@move2modern.co.uk',            'Managing Director',              'Leadership', 'M2M000', NULL,             NULL,                                'standard persona', 'London', true, true, true, true, true, true, true, '2024-04-15', v_m2m_andy,  v_m2m_id),
    ('Joiner', 'complete', 'Sarah', 'Mitchell',  '2024-03-01', 'sarah.mitchell@move2modern.co.uk',  'Head of Digital Transformation', 'Technology', 'M2M001', 'Andy Jones',     'andy@move2modern.co.uk',            'standard persona', 'London', true, true, true, true, true, true, true, '2024-06-01', v_m2m_sarah, v_m2m_id),
    ('Joiner', 'complete', 'James', 'Cooper',    '2024-06-15', 'james.cooper@move2modern.co.uk',    'Senior Cloud Engineer',          'Technology', 'M2M002', 'Sarah Mitchell', 'sarah.mitchell@move2modern.co.uk',  'standard persona', 'London', true, true, true, true, true, true, true, '2024-09-15', v_m2m_james, v_m2m_id),
    ('Joiner', 'complete', 'Priya', 'Patel',     '2024-09-01', 'priya.patel@move2modern.co.uk',     'UX Design Lead',                'Design',     'M2M003', 'Sarah Mitchell', 'sarah.mitchell@move2modern.co.uk',  'standard persona', 'London', true, true, true, true, true, true, true, '2024-12-01', v_m2m_priya, v_m2m_id),
    ('Joiner', 'complete', 'Tom',   'Henderson', '2025-01-13', 'tom.henderson@move2modern.co.uk',   'Project Manager',                'Delivery',   'M2M004', 'Sarah Mitchell', 'sarah.mitchell@move2modern.co.uk',  'standard persona', 'London', true, true, true, true, true, true, true, '2025-04-13', v_m2m_tom,   v_m2m_id),
    ('Joiner', 'complete', 'Lucy',  'Chen',      '2025-04-07', 'lucy.chen@move2modern.co.uk',       'Business Analyst',               'Delivery',   'M2M005', 'Tom Henderson',  'tom.henderson@move2modern.co.uk',   'standard persona', 'London', true, true, true, true, true, true, true, '2025-07-07', v_m2m_lucy,  v_m2m_id);

  -- ========== TIMESHEETS ==========
  INSERT INTO timesheets (employee_id, location, customer, role, date, start_time, end_time, status, submitted_at, company_id) VALUES
    (v_m2m_andy,  'Home',          'Kumonix',       'Management', '2026-07-21', '08:30', '17:30', 'approved', '2026-07-21T17:30:00Z', v_m2m_id),
    (v_m2m_sarah, 'Head Office',   NULL,            'Engineering','2026-07-21', '09:00', '17:00', 'approved', '2026-07-21T17:00:00Z', v_m2m_id),
    (v_m2m_james, 'Customer Site', 'DataFlow Inc',  'Engineering','2026-07-22', '09:00', '18:00', 'pending',  '2026-07-22T18:00:00Z', v_m2m_id),
    (v_m2m_priya, 'Head Office',   NULL,            'Design',     '2026-07-21', '10:00', '18:00', 'approved', '2026-07-21T18:00:00Z', v_m2m_id),
    (v_m2m_tom,   'Customer Site', 'Acme Corp',     'Delivery',   '2026-07-22', '08:00', '17:00', 'pending',  '2026-07-22T17:00:00Z', v_m2m_id);

  -- ========== WORKFLOW TRACKER ==========
  INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, task_description, approval_id, company_id) VALUES
    ('James Cooper',  1, 'Pending',  'Leave',   'Approve annual leave',   'james.cooper@move2modern.co.uk',  'sarah.mitchell@move2modern.co.uk', 'Annual Leave - 08/09/2026 to 12/09/2026 (5 days)',  v_m2m_lr_james, v_m2m_id),
    ('Priya Patel',   1, 'Pending',  'Leave',   'Approve annual leave',   'priya.patel@move2modern.co.uk',   'sarah.mitchell@move2modern.co.uk', 'Annual Leave - 20/10/2026 to 24/10/2026 (5 days)',  v_m2m_lr_priya, v_m2m_id),
    ('Lucy Chen',     1, 'Pending',  'Leave',   'Approve annual leave',   'lucy.chen@move2modern.co.uk',     'sarah.mitchell@move2modern.co.uk', 'Annual Leave - 25/08/2026 to 26/08/2026 (2 days)',  v_m2m_lr_lucy,  v_m2m_id),
    ('Priya Patel',   1, 'Pending',  'Expense', 'Approve expense claim',  'priya.patel@move2modern.co.uk',   'sarah.mitchell@move2modern.co.uk', 'Design conference ticket - £450.00',                v_m2m_claim3,   v_m2m_id),
    ('Tom Henderson', 1, 'Pending',  'Expense', 'Approve expense claim',  'tom.henderson@move2modern.co.uk', 'sarah.mitchell@move2modern.co.uk', 'Train to client site - £89.50',                     v_m2m_claim4,   v_m2m_id),
    ('James Cooper',  1, 'Complete', 'Expense', 'Expense claim approved', 'james.cooper@move2modern.co.uk',  'sarah.mitchell@move2modern.co.uk', 'AWS certification exam - £300.00',                  v_m2m_claim2,   v_m2m_id);

  -- ========== NOTIFICATIONS ==========
  INSERT INTO notifications (employee_id, title, message, type, is_read, company_id) VALUES
    (v_m2m_sarah, 'Leave request pending',  'James Cooper has submitted a leave request for your approval',          'action', false, v_m2m_id),
    (v_m2m_sarah, 'Expense claim pending',  'Priya Patel submitted an expense claim (M2M-EXP-003) for £450.00',     'action', false, v_m2m_id),
    (v_m2m_sarah, 'New kudos received',     'Priya Patel sent you a kudos for championing UX research budget',       'info',   true,  v_m2m_id),
    (v_m2m_james, 'Leave approved',         'Your sick leave (23 Jun) has been approved by Sarah Mitchell',           'info',   true,  v_m2m_id),
    (v_m2m_james, 'New kudos received',     'Sarah Mitchell sent you a kudos - great work on the AWS migration!',    'info',   false, v_m2m_id),
    (v_m2m_priya, 'Mandatory training due', 'Fire Safety course is not yet started - please complete soon',          'alert',  false, v_m2m_id),
    (v_m2m_lucy,  'Onboarding complete',    'All onboarding steps have been completed. Welcome to the team!',         'info',   true,  v_m2m_id);

  -- ========== 1:1 MEETINGS (Move2Modern) ==========
  INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, summary, completed_at, company_id) VALUES
    (v_m2m_andy,  v_m2m_sarah, '2026-07-10', '10:00', 'completed', 'Reviewed digital transformation roadmap. Sarah is leading the cloud migration well. Discussed hiring plan for Q4.', '2026-07-10 11:00:00+00', v_m2m_id),
    (v_m2m_andy,  v_m2m_tom,   '2026-07-15', '14:00', 'completed', 'Tom presented the delivery timeline for Project Atlas. On track. Discussed Lucy''s progress and onboarding.', '2026-07-15 15:00:00+00', v_m2m_id),
    (v_m2m_sarah, v_m2m_james, '2026-07-18', '11:00', 'completed', 'James completed AWS migration ahead of schedule. Discussed certification path — will support SA Pro exam prep.', '2026-07-18 12:00:00+00', v_m2m_id),
    (v_m2m_sarah, v_m2m_priya, '2026-07-22', '10:00', 'completed', 'Priya''s UX research findings are excellent. Discussed expanding the design system. Career goal: Priya to attend UX London.', '2026-07-22 11:00:00+00', v_m2m_id),
    (v_m2m_tom,   v_m2m_lucy,  '2026-07-25', '09:30', 'completed', 'Lucy is settling in well. Reviewed business analysis deliverables. Agreed on mentoring sessions with Sarah.', '2026-07-25 10:30:00+00', v_m2m_id),
    (v_m2m_andy,  v_m2m_sarah, '2026-08-07', '10:00', 'pending',   NULL, NULL, v_m2m_id),
    (v_m2m_sarah, v_m2m_james, '2026-08-08', '11:00', 'accepted',  NULL, NULL, v_m2m_id);

  -- ========== APP SETTINGS (Move2Modern) ==========
  INSERT INTO app_settings (id, language, financial_year_start_month, country_code, company_id)
  VALUES (2, 'en', 4, 'GB', v_m2m_id)
  ON CONFLICT (id) DO UPDATE SET language='en', financial_year_start_month=4, country_code='GB', company_id=v_m2m_id;

  -- ========== USER SETTINGS ==========
  INSERT INTO user_settings (employee_id, language, features_config) VALUES
    (v_m2m_andy,  'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
    (v_m2m_sarah, 'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
    (v_m2m_james, 'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
    (v_m2m_priya, 'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
    (v_m2m_tom,   'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}'),
    (v_m2m_lucy,  'en', '{"expenses":true,"leave":true,"profile":true,"payslips":true,"kudos":true,"benefits":true,"elearning":true,"performance":true}');

  RETURN 'Demo seed complete: 2 companies (Kumonix + Move2Modern), 11 employees, all features populated';
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

-- Also fire on UPDATE (Supabase updates auth.users on each login)
DROP TRIGGER IF EXISTS on_auth_user_created_sso ON auth.users;
CREATE TRIGGER on_auth_user_created_sso
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_sso_user();

-- ============================================================
-- RPC for frontend fallback: ensure current user is linked to
-- their company based on email domain (SECURITY DEFINER bypasses RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_company_user()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_domain text;
  v_company_id uuid;
  v_employee_id uuid;
  v_cu_id bigint;
  v_role text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'Not authenticated');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  v_domain := split_part(v_email, '@', 2);

  -- Check if company_users entry already exists
  SELECT id, company_id, role, employee_id INTO v_cu_id, v_company_id, v_role, v_employee_id
  FROM company_users
  WHERE auth_user_id = v_user_id AND is_active = true
  LIMIT 1;

  IF v_cu_id IS NOT NULL THEN
    RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
  END IF;

  -- Look up company by domain
  SELECT id INTO v_company_id
  FROM companies
  WHERE domain = v_domain AND is_active = true;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('error', 'No matching company');
  END IF;

  -- Look up employee by email
  SELECT id INTO v_employee_id
  FROM employees
  WHERE email = v_email AND company_id = v_company_id;

  -- Determine role
  v_role := 'employee';
  IF v_employee_id IS NOT NULL THEN
    SELECT CASE WHEN is_admin THEN 'admin' ELSE 'employee' END INTO v_role
    FROM employees WHERE id = v_employee_id;
  END IF;

  -- Create the link
  INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
  VALUES (v_user_id, v_company_id, v_employee_id, v_role, true)
  ON CONFLICT (auth_user_id, company_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, role = EXCLUDED.role
  RETURNING id INTO v_cu_id;

  RETURN json_build_object('id', v_cu_id, 'company_id', v_company_id, 'role', v_role, 'employee_id', v_employee_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_company_user() TO authenticated;
