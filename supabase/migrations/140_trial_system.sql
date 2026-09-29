-- 140: Trial registration system
-- Replaces old demo seed with a proper trial funnel:
-- 1. Public trial_requests table for prospect signups
-- 2. create_trial_data RPC for super admin to provision trial companies
-- 3. Drops old run_demo_seed RPC

-- ═══════════════════════════════════════════════════════════════
-- 1. Trial requests table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS trial_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  work_email TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  company_name TEXT,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  admin_password TEXT,
  employee_email TEXT,
  employee_password TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES auth.users(id),
  CONSTRAINT trial_requests_email_unique UNIQUE (work_email)
);

ALTER TABLE trial_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a trial request"
  ON trial_requests FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read trial requests"
  ON trial_requests FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update trial requests"
  ON trial_requests FOR UPDATE TO authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 2. create_trial_data RPC
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_trial_data(
  p_request_id UUID,
  p_company_name TEXT
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_company_id UUID;
  v_slug TEXT;
  v_admin_password TEXT;
  v_admin_user_id UUID;
  v_admin_employee_id UUID;
  v_emp_password TEXT;
  v_emp_user_id UUID;
  v_encrypted_pw TEXT;

  -- Employee IDs
  v_emp1 UUID; v_emp2 UUID; v_emp3 UUID; v_emp4 UUID; v_emp5 UUID;
  v_emp6 UUID; v_emp7 UUID; v_emp8 UUID; v_emp9 UUID; v_emp10 UUID;

  -- Leave type IDs
  v_lt_annual BIGINT; v_lt_sick BIGINT;

  -- Expense claim IDs
  v_claim1 BIGINT; v_claim2 BIGINT; v_claim3 BIGINT; v_claim4 BIGINT; v_claim5 BIGINT;

  -- Leave request IDs (for workflow_tracker)
  v_lr1 BIGINT; v_lr2 BIGINT; v_lr3 BIGINT;

  -- Benefit IDs
  v_ben1 BIGINT; v_ben2 BIGINT; v_ben3 BIGINT; v_ben4 BIGINT;

  -- Course IDs
  v_c1 BIGINT; v_c2 BIGINT; v_c3 BIGINT; v_c4 BIGINT;

  -- 1:1 Meeting IDs
  v_mtg1 BIGINT; v_mtg2 BIGINT; v_mtg3 BIGINT;

  -- Rota/shift IDs
  v_rota1 BIGINT;
  v_st_morning BIGINT; v_st_afternoon BIGINT; v_st_night BIGINT;

  -- Space booking IDs
  v_loc1 BIGINT; v_floor1 BIGINT;
  v_space1 BIGINT; v_space2 BIGINT; v_space3 BIGINT;

  -- Skill IDs
  v_scat1 BIGINT; v_scat2 BIGINT; v_scat3 BIGINT;
  v_skill1 UUID; v_skill2 UUID; v_skill3 UUID; v_skill4 UUID; v_skill5 UUID; v_skill6 UUID;

  -- Work pattern IDs
  v_wp_fixed UUID; v_wp_variable UUID;

  -- Survey IDs
  v_survey1 BIGINT;
  v_deploy1 BIGINT;

  -- Loop counters
  v_emp_ids UUID[];
  v_emp_id UUID;
  v_mon INT;
BEGIN
  -- ─── Security check ───
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  IF p_company_name IS NULL OR trim(p_company_name) = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  -- ─── Load request ───
  SELECT * INTO v_request FROM trial_requests WHERE id = p_request_id;
  IF v_request IS NULL THEN
    RAISE EXCEPTION 'Trial request not found';
  END IF;
  IF v_request.status != 'pending' THEN
    RAISE EXCEPTION 'Trial request already processed';
  END IF;

  -- ─── Generate IDs and passwords ───
  v_company_id := gen_random_uuid();
  v_slug := lower(regexp_replace(trim(p_company_name), '[^a-zA-Z0-9]', '', 'g'));
  v_admin_password := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_emp_password := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  -- ═══════════════════════════════════════════════════════════
  -- COMPANY
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO companies (id, name, microsoft_tenant_id, domain, is_active, is_trial, trial_start_date, trial_end_date, auth_mode, timezone, date_format, currency)
  VALUES (v_company_id, trim(p_company_name), 'trial-' || v_slug, v_slug || '-trial.example.com', true, true, CURRENT_DATE, CURRENT_DATE + 14, 'non_sso', 'Europe/London', 'DD/MM/YYYY', 'GBP');

  -- ═══════════════════════════════════════════════════════════
  -- ADMIN AUTH ACCOUNT (requestor's work email)
  -- ═══════════════════════════════════════════════════════════

  v_admin_user_id := gen_random_uuid();
  v_encrypted_pw := extensions.crypt(v_admin_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_admin_user_id,
    'authenticated', 'authenticated', v_request.work_email, v_encrypted_pw,
    NOW(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('sub', v_admin_user_id::text, 'email', v_request.work_email, 'email_verified', true, 'company_id', v_company_id::text, 'auth_mode', 'non_sso'),
    NOW(), NOW(), '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), v_admin_user_id, jsonb_build_object('sub', v_admin_user_id::text, 'email', v_request.work_email, 'email_verified', true), 'email', v_admin_user_id::text, NOW(), NOW(), NOW());

  -- Admin employee record
  INSERT INTO employees (employee_number, first_name, last_name, email, job_title, department, is_admin, is_active, can_post_notifications, company_id, start_date, contract_type, leave_allowance)
  VALUES ('ADMIN-001', split_part(v_request.full_name, ' ', 1), COALESCE(NULLIF(split_part(v_request.full_name, ' ', 2), ''), 'Admin'), v_request.work_email, 'Company Administrator', 'Administration', true, true, true, v_company_id, CURRENT_DATE, 'Full-time', 25)
  RETURNING id INTO v_admin_employee_id;

  INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
  VALUES (v_admin_user_id, v_company_id, v_admin_employee_id, 'admin', true);

  UPDATE companies SET nonsso_username = v_request.work_email WHERE id = v_company_id;

  -- ═══════════════════════════════════════════════════════════
  -- 10 DEMO EMPLOYEES
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO employees (employee_number, first_name, last_name, email, job_title, department, manager_id, start_date, phone, is_admin, is_active, can_post_notifications, company_id, contract_type, leave_allowance)
  VALUES
    ('EMP-001', 'Sarah',  'Mitchell',  'demo1@' || v_slug || '-trial.example.com', 'HR Manager',            'HR',          v_admin_employee_id, '2024-03-15', '+44 7700 200001', false, true, true,  v_company_id, 'Full-time', 25),
    ('EMP-002', 'James',  'Wilson',    'demo2@' || v_slug || '-trial.example.com', 'Lead Developer',        'Engineering', v_admin_employee_id, '2024-06-01', '+44 7700 200002', false, true, false, v_company_id, 'Full-time', 25),
    ('EMP-003', 'Emma',   'Thompson',  'demo3@' || v_slug || '-trial.example.com', 'Financial Controller',  'Finance',     v_admin_employee_id, '2024-01-10', '+44 7700 200003', false, true, false, v_company_id, 'Full-time', 25),
    ('EMP-004', 'Tom',    'Richards',  'demo4@' || v_slug || '-trial.example.com', 'Operations Manager',    'Operations',  v_admin_employee_id, '2024-09-01', '+44 7700 200004', false, true, false, v_company_id, 'Full-time', 25),
    ('EMP-005', 'Priya',  'Sharma',    'demo5@' || v_slug || '-trial.example.com', 'Marketing Executive',   'Marketing',   v_admin_employee_id, '2025-01-06', '+44 7700 200005', false, true, false, v_company_id, 'Full-time', 25),
    ('EMP-006', 'Lucy',   'Bennett',   'demo6@' || v_slug || '-trial.example.com', 'HR Assistant',          'HR',          NULL,                '2025-03-10', '+44 7700 200006', false, true, false, v_company_id, 'Full-time', 25),
    ('EMP-007', 'Daniel', 'O''Brien',  'demo7@' || v_slug || '-trial.example.com', 'Software Engineer',     'Engineering', NULL,                '2024-11-01', '+44 7700 200007', false, true, false, v_company_id, 'Full-time', 25),
    ('EMP-008', 'Aisha',  'Khan',      'demo8@' || v_slug || '-trial.example.com', 'Accounts Payable',      'Finance',     NULL,                '2025-02-17', '+44 7700 200008', false, true, false, v_company_id, 'Part-time', 25),
    ('EMP-009', 'Marcus', 'Johnson',   'demo9@' || v_slug || '-trial.example.com', 'Warehouse Supervisor',  'Operations',  NULL,                '2024-07-15', '+44 7700 200009', false, true, false, v_company_id, 'Full-time', 25),
    ('EMP-010', 'Sophie', 'Williams',  'demo10@' || v_slug || '-trial.example.com','Content Manager',       'Marketing',   NULL,                '2025-04-01', '+44 7700 200010', false, true, false, v_company_id, 'Full-time', 25);

  SELECT id INTO v_emp1 FROM employees WHERE employee_number='EMP-001' AND company_id=v_company_id;
  SELECT id INTO v_emp2 FROM employees WHERE employee_number='EMP-002' AND company_id=v_company_id;
  SELECT id INTO v_emp3 FROM employees WHERE employee_number='EMP-003' AND company_id=v_company_id;
  SELECT id INTO v_emp4 FROM employees WHERE employee_number='EMP-004' AND company_id=v_company_id;
  SELECT id INTO v_emp5 FROM employees WHERE employee_number='EMP-005' AND company_id=v_company_id;
  SELECT id INTO v_emp6 FROM employees WHERE employee_number='EMP-006' AND company_id=v_company_id;
  SELECT id INTO v_emp7 FROM employees WHERE employee_number='EMP-007' AND company_id=v_company_id;
  SELECT id INTO v_emp8 FROM employees WHERE employee_number='EMP-008' AND company_id=v_company_id;
  SELECT id INTO v_emp9 FROM employees WHERE employee_number='EMP-009' AND company_id=v_company_id;
  SELECT id INTO v_emp10 FROM employees WHERE employee_number='EMP-010' AND company_id=v_company_id;

  v_emp_ids := ARRAY[v_emp1, v_emp2, v_emp3, v_emp4, v_emp5, v_emp6, v_emp7, v_emp8, v_emp9, v_emp10];

  -- Set managers: emp6 reports to emp1 (HR), emp7 to emp2 (Eng), emp8 to emp3 (Fin), emp9 to emp4 (Ops), emp10 to emp5 (Mkt)
  UPDATE employees SET manager_id = v_emp1 WHERE id = v_emp6;
  UPDATE employees SET manager_id = v_emp2 WHERE id = v_emp7;
  UPDATE employees SET manager_id = v_emp3 WHERE id = v_emp8;
  UPDATE employees SET manager_id = v_emp4 WHERE id = v_emp9;
  UPDATE employees SET manager_id = v_emp5 WHERE id = v_emp10;

  -- ═══════════════════════════════════════════════════════════
  -- TEST EMPLOYEE AUTH ACCOUNT (demo1 = Sarah Mitchell)
  -- ═══════════════════════════════════════════════════════════

  v_emp_user_id := gen_random_uuid();
  v_encrypted_pw := extensions.crypt(v_emp_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_emp_user_id,
    'authenticated', 'authenticated', 'demo1@' || v_slug || '-trial.example.com', v_encrypted_pw,
    NOW(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('sub', v_emp_user_id::text, 'email', 'demo1@' || v_slug || '-trial.example.com', 'email_verified', true, 'company_id', v_company_id::text, 'auth_mode', 'non_sso'),
    NOW(), NOW(), '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), v_emp_user_id, jsonb_build_object('sub', v_emp_user_id::text, 'email', 'demo1@' || v_slug || '-trial.example.com', 'email_verified', true), 'email', v_emp_user_id::text, NOW(), NOW(), NOW());

  UPDATE employees SET auth_user_id = v_emp_user_id WHERE id = v_emp1;

  INSERT INTO company_users (auth_user_id, company_id, employee_id, role, is_active)
  VALUES (v_emp_user_id, v_company_id, v_emp1, 'employee', true);

  -- ═══════════════════════════════════════════════════════════
  -- WORK PATTERNS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO work_patterns (name, type, company_id, mon_start, mon_end, tue_start, tue_end, wed_start, wed_end, thu_start, thu_end, fri_start, fri_end)
  VALUES ('Standard Office Hours', 'fixed', v_company_id, '09:00', '17:30', '09:00', '17:30', '09:00', '17:30', '09:00', '17:30', '09:00', '17:30')
  RETURNING id INTO v_wp_fixed;

  INSERT INTO work_patterns (name, type, company_id)
  VALUES ('Variable Shifts', 'variable', v_company_id)
  RETURNING id INTO v_wp_variable;

  -- Fixed pattern: emp1(Sarah), emp2(James), emp3(Emma), emp5(Priya), emp7(Daniel)
  UPDATE employees SET work_pattern_id = v_wp_fixed WHERE id IN (v_emp1, v_emp2, v_emp3, v_emp5, v_emp7) AND company_id = v_company_id;
  -- Variable pattern: emp4(Tom), emp6(Lucy), emp8(Aisha), emp9(Marcus), emp10(Sophie)
  UPDATE employees SET work_pattern_id = v_wp_variable WHERE id IN (v_emp4, v_emp6, v_emp8, v_emp9, v_emp10) AND company_id = v_company_id;
  -- Admin also fixed
  UPDATE employees SET work_pattern_id = v_wp_fixed WHERE id = v_admin_employee_id AND company_id = v_company_id;

  -- ═══════════════════════════════════════════════════════════
  -- LEAVE
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO leave_types (name, default_allowance, colour, is_active, company_id) VALUES
    ('Annual Leave',       25, '#4caf50', true, v_company_id),
    ('Sick Leave',         10, '#f44336', true, v_company_id),
    ('Jury Duty',           5, '#9c27b0', true, v_company_id),
    ('Bereavement',         5, '#607d8b', true, v_company_id),
    ('Exam Leave',          3, '#ff9800', true, v_company_id),
    ('Carers Leave',        5, '#00bcd4', true, v_company_id),
    ('Career Break',      365, '#795548', true, v_company_id),
    ('Lieu Days',          10, '#2196f3', true, v_company_id);

  SELECT id INTO v_lt_annual FROM leave_types WHERE name='Annual Leave' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_lt_sick FROM leave_types WHERE name='Sick Leave' AND company_id=v_company_id LIMIT 1;

  -- Leave balances for all employees
  INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over, company_id)
  SELECT e.id, v_lt_annual, EXTRACT(YEAR FROM CURRENT_DATE)::int, 25,
    CASE WHEN e.id IN (v_emp1, v_emp3, v_emp5) THEN 5 WHEN e.id IN (v_emp2, v_emp4) THEN 8 ELSE 3 END,
    CASE WHEN e.id IN (v_emp1, v_emp3) THEN 2 ELSE 0 END,
    v_company_id
  FROM employees e WHERE e.company_id = v_company_id AND e.id != v_admin_employee_id;

  INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over, company_id)
  SELECT e.id, v_lt_sick, EXTRACT(YEAR FROM CURRENT_DATE)::int, 10,
    CASE WHEN e.id IN (v_emp1, v_emp6) THEN 2 WHEN e.id = v_emp9 THEN 1 ELSE 0 END,
    0, v_company_id
  FROM employees e WHERE e.company_id = v_company_id AND e.id != v_admin_employee_id;

  -- Admin leave balances
  INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over, company_id)
  VALUES (v_admin_employee_id, v_lt_annual, EXTRACT(YEAR FROM CURRENT_DATE)::int, 28, 4, 3, v_company_id),
         (v_admin_employee_id, v_lt_sick, EXTRACT(YEAR FROM CURRENT_DATE)::int, 10, 1, 0, v_company_id);

  -- Leave requests
  INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, status, reason, approved_by, company_id) VALUES
    (v_emp1,  v_lt_annual, CURRENT_DATE + 14, CURRENT_DATE + 16, 3, 'approved', 'Family event',          v_admin_employee_id, v_company_id),
    (v_emp2,  v_lt_annual, CURRENT_DATE + 21, CURRENT_DATE + 25, 5, 'pending',  'Holiday abroad',        NULL,                v_company_id),
    (v_emp3,  v_lt_sick,   CURRENT_DATE - 5,  CURRENT_DATE - 4,  2, 'approved', 'Feeling unwell',        v_admin_employee_id, v_company_id),
    (v_emp4,  v_lt_annual, CURRENT_DATE + 30, CURRENT_DATE + 34, 5, 'pending',  'Summer break',          NULL,                v_company_id),
    (v_emp5,  v_lt_annual, CURRENT_DATE + 7,  CURRENT_DATE + 8,  2, 'approved', 'Wedding attendance',    v_admin_employee_id, v_company_id),
    (v_emp6,  v_lt_annual, CURRENT_DATE + 45, CURRENT_DATE + 49, 5, 'pending',  'Christmas break',       NULL,                v_company_id),
    (v_emp9,  v_lt_sick,   CURRENT_DATE - 2,  CURRENT_DATE - 2,  1, 'approved', 'Doctor appointment',    v_emp4,              v_company_id),
    (v_admin_employee_id, v_lt_annual, CURRENT_DATE + 60, CURRENT_DATE + 64, 5, 'approved', 'Year-end break', v_emp1, v_company_id);

  SELECT id INTO v_lr1 FROM leave_requests WHERE employee_id=v_emp2 AND status='pending' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_lr2 FROM leave_requests WHERE employee_id=v_emp4 AND status='pending' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_lr3 FROM leave_requests WHERE employee_id=v_emp6 AND status='pending' AND company_id=v_company_id LIMIT 1;

  -- ═══════════════════════════════════════════════════════════
  -- EXPENSES
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO expense_claims (employee_id, reference_number, title, description, amount, status, category, submitted_at, start_date, end_date, company_id) VALUES
    (v_emp1,  'EXP-T-001', 'HR Conference',          'Annual CIPD Conference',            450.00,  'approved',  'Training',        NOW() - interval '10 days', CURRENT_DATE - 10, CURRENT_DATE - 10, v_company_id),
    (v_emp2,  'EXP-T-002', 'Client meeting lunch',   'Lunch with prospect',                85.50,  'pending',   'Meals',           NOW() - interval '3 days',  CURRENT_DATE - 3,  CURRENT_DATE - 3,  v_company_id),
    (v_emp3,  'EXP-T-003', 'Software licence',       'Xero annual renewal',               168.00,  'approved',  'Software',        NOW() - interval '15 days', CURRENT_DATE - 15, CURRENT_DATE - 15, v_company_id),
    (v_emp4,  'EXP-T-004', 'Travel to warehouse',    'Return train to Birmingham',        124.00,  'draft',     'Travel',          NULL,                        CURRENT_DATE - 1,  CURRENT_DATE - 1,  v_company_id),
    (v_emp7,  'EXP-T-005', 'Team building',          'Escape room for Engineering',       210.75,  'approved',  'Team Activities', NOW() - interval '20 days', CURRENT_DATE - 20, CURRENT_DATE - 20, v_company_id);

  SELECT id INTO v_claim1 FROM expense_claims WHERE reference_number='EXP-T-001' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_claim2 FROM expense_claims WHERE reference_number='EXP-T-002' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_claim3 FROM expense_claims WHERE reference_number='EXP-T-003' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_claim4 FROM expense_claims WHERE reference_number='EXP-T-004' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_claim5 FROM expense_claims WHERE reference_number='EXP-T-005' AND company_id=v_company_id LIMIT 1;

  INSERT INTO expense_line_items (expense_claim_id, title, expense_type, description, date_of_purchase, amount, company_id) VALUES
    (v_claim1, 'Conference ticket',   'Training',        'CIPD Annual 2026',        CURRENT_DATE - 10, 350.00, v_company_id),
    (v_claim1, 'Train to venue',      'Travel',          'Return ticket',           CURRENT_DATE - 10, 100.00, v_company_id),
    (v_claim2, 'Restaurant bill',     'Meals',           'Italian restaurant',      CURRENT_DATE - 3,   72.00, v_company_id),
    (v_claim2, 'Taxi',                'Travel',          'Uber to restaurant',      CURRENT_DATE - 3,   13.50, v_company_id),
    (v_claim3, 'Xero licence',        'Software',        'Annual subscription',     CURRENT_DATE - 15, 168.00, v_company_id),
    (v_claim4, 'Train tickets',       'Travel',          'Birmingham return',       CURRENT_DATE - 1,  124.00, v_company_id),
    (v_claim5, 'Escape room booking', 'Team Activities', '6 person booking',        CURRENT_DATE - 20, 180.00, v_company_id),
    (v_claim5, 'Drinks after',        'Meals',           'Pub round',               CURRENT_DATE - 20,  30.75, v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- PAYSLIPS (3 months for all 11 employees)
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO payslips (employee_id, reference_number, pay_period_start, pay_period_end, gross_pay, tax, national_insurance, pension, other_deductions, net_pay, payment_date, status, tax_code, annual_salary, payroll_id, bank_account, payroll_office, overtime, adjustments, monthly_deductions, company_id)
  SELECT
    e.id,
    'PAY-T-' || lpad(m.mon::text, 2, '0') || '-' || left(e.first_name, 1) || left(e.last_name, 1),
    make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, m.mon, 1),
    (make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, m.mon, 1) + interval '1 month - 1 day')::date,
    round(e.annual_sal / 12, 2),
    round(e.annual_sal / 12 * 0.20, 2),
    round(e.annual_sal / 12 * 0.08, 2),
    round(e.annual_sal / 12 * 0.05, 2),
    0,
    round(e.annual_sal / 12 * 0.67, 2),
    (make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, m.mon, 1) + interval '1 month - 4 day')::date,
    CASE WHEN m.mon = EXTRACT(MONTH FROM CURRENT_DATE)::int THEN 'processed' ELSE 'paid' END,
    '1257L',
    e.annual_sal,
    'TRL-' || lpad(e.emp_idx::text, 3, '0'),
    '****' || (1000 + e.emp_idx * 1111)::text,
    'London', 0, 0, 0, v_company_id
  FROM (VALUES
    (v_admin_employee_id, 'Admin', 'User',    60000, 0),
    (v_emp1,  'Sarah',  'Mitchell',  45000, 1),
    (v_emp2,  'James',  'Wilson',    55000, 2),
    (v_emp3,  'Emma',   'Thompson',  52000, 3),
    (v_emp4,  'Tom',    'Richards',  42000, 4),
    (v_emp5,  'Priya',  'Sharma',    38000, 5),
    (v_emp6,  'Lucy',   'Bennett',   32000, 6),
    (v_emp7,  'Daniel', 'OBrien',    48000, 7),
    (v_emp8,  'Aisha',  'Khan',      28000, 8),
    (v_emp9,  'Marcus', 'Johnson',   35000, 9),
    (v_emp10, 'Sophie', 'Williams',  40000, 10)
  ) AS e(id, first_name, last_name, annual_sal, emp_idx)
  CROSS JOIN (
    SELECT EXTRACT(MONTH FROM CURRENT_DATE)::int AS mon
    UNION ALL SELECT EXTRACT(MONTH FROM CURRENT_DATE - interval '1 month')::int
    UNION ALL SELECT EXTRACT(MONTH FROM CURRENT_DATE - interval '2 months')::int
  ) AS m;

  -- ═══════════════════════════════════════════════════════════
  -- KUDOS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO kudos (from_employee_id, to_employee_id, message, category, recognition_type, badge, quality, is_broadcast, like_count, liked_by, company_id) VALUES
    (v_emp1, v_emp2,  'Brilliant work on the API deployment — shipped early!',                          'innovation',     'recognition', 'star',   'Innovation',           false, 3, ARRAY[v_emp3, v_emp4, v_emp5],   v_company_id),
    (v_emp2, v_emp7,  'Great pair programming session on the auth module.',                             'teamwork',       'recognition', 'heart',  'Teamwork',             false, 2, ARRAY[v_emp1, v_emp5],           v_company_id),
    (v_emp3, v_emp1,  'Thank you for organising the onboarding for our new starters!',                  'leadership',     'recognition', 'trophy', 'Leadership',           false, 4, ARRAY[v_emp2, v_emp4, v_emp6, v_emp7], v_company_id),
    (v_emp4, v_emp9,  'Excellent warehouse audit — every item accounted for.',                          'customer_focus', 'recognition', 'gem',    'Attention to Detail',  false, 1, ARRAY[v_emp3],                   v_company_id),
    (v_emp5, NULL,    'Happy Friday everyone! Have a wonderful weekend.',                               NULL,             'broadcast',   NULL,     NULL,                   true,  2, ARRAY[v_emp1, v_emp6],           v_company_id),
    (v_emp6, v_emp1,  'Your mentoring has really helped me settle into the team.',                      'going_above',    'recognition', 'rocket', 'Going Above & Beyond', false, 1, ARRAY[v_emp3],                   v_company_id),
    (v_emp7, v_emp2,  'The code review feedback was incredibly thorough and constructive.',             'innovation',     'recognition', 'star',   'Quality',              false, 2, ARRAY[v_emp1, v_emp9],           v_company_id),
    (v_admin_employee_id, v_emp3, 'Outstanding work on the quarterly financials report.',               'leadership',     'recognition', 'trophy', 'Excellence',           false, 3, ARRAY[v_emp1, v_emp2, v_emp4],   v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- ANNOUNCEMENTS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO announcements (title, body, author_id, is_pinned, published_at, submitted_by_name, company_id) VALUES
    ('Welcome to InflowHR',                'Take a look within Settings and choose the guide to get to know your app and its features.',                                                   NULL, true,  NOW(), 'InflowHR', v_company_id),
    ('Quarterly All-Hands Meeting',        'Join us next Friday at 2pm for the quarterly all-hands. We will cover company performance, upcoming initiatives, and team highlights.',        v_admin_employee_id, true,  NOW() - interval '5 days', split_part(v_request.full_name, ' ', 1) || ' ' || COALESCE(NULLIF(split_part(v_request.full_name, ' ', 2), ''), ''), v_company_id),
    ('New Benefits Portal',                'We are excited to announce the launch of our updated benefits portal. Manage pension, cycle-to-work, and health insurance in one place.',      v_emp1, false, NOW() - interval '10 days', 'Sarah Mitchell', v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- BENEFITS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO benefit_types (name, description, category, provider, is_active, company_id) VALUES
    ('Private Health Insurance', 'Comprehensive medical cover including dental and optical', 'Health',    'Bupa',        true, v_company_id),
    ('Cycle to Work Scheme',     'Tax-free bike purchase up to £2,000',                     'Lifestyle', 'Cyclescheme', true, v_company_id),
    ('Pension',                  'Employer matches up to 5% of salary',                     'Financial', 'Aviva',       true, v_company_id),
    ('Gym Membership',           'Discounted corporate rate at PureGym',                    'Health',    'PureGym',     true, v_company_id);

  SELECT id INTO v_ben1 FROM benefit_types WHERE name='Private Health Insurance' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_ben2 FROM benefit_types WHERE name='Cycle to Work Scheme' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_ben3 FROM benefit_types WHERE name='Pension' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_ben4 FROM benefit_types WHERE name='Gym Membership' AND company_id=v_company_id LIMIT 1;

  INSERT INTO benefit_enrollments (employee_id, benefit_type_id, status, company_id) VALUES
    (v_emp1, v_ben1, 'active', v_company_id), (v_emp1, v_ben3, 'active', v_company_id),
    (v_emp2, v_ben1, 'active', v_company_id), (v_emp2, v_ben2, 'active', v_company_id), (v_emp2, v_ben3, 'active', v_company_id),
    (v_emp3, v_ben3, 'active', v_company_id), (v_emp3, v_ben4, 'active', v_company_id),
    (v_emp4, v_ben1, 'active', v_company_id), (v_emp4, v_ben3, 'active', v_company_id),
    (v_emp5, v_ben2, 'active', v_company_id), (v_emp5, v_ben4, 'pending', v_company_id),
    (v_emp7, v_ben1, 'active', v_company_id), (v_emp7, v_ben3, 'active', v_company_id),
    (v_emp9, v_ben3, 'active', v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- E-LEARNING COURSES
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO courses (title, description, category, duration_minutes, is_mandatory, is_active) VALUES
    ('Data Protection & GDPR',   'Understanding your obligations under UK GDPR',       'Compliance',      45, true,  true),
    ('Cyber Security Awareness', 'Phishing, passwords, and safe browsing practices',   'IT Security',     30, true,  true),
    ('Fire Safety',              'Evacuation procedures and fire prevention',           'Health & Safety', 20, true,  true),
    ('Inclusive Leadership',     'Building diverse and inclusive teams',                 'Leadership',      60, false, true);

  SELECT id INTO v_c1 FROM courses WHERE title='Data Protection & GDPR' LIMIT 1;
  SELECT id INTO v_c2 FROM courses WHERE title='Cyber Security Awareness' LIMIT 1;
  SELECT id INTO v_c3 FROM courses WHERE title='Fire Safety' LIMIT 1;
  SELECT id INTO v_c4 FROM courses WHERE title='Inclusive Leadership' LIMIT 1;

  INSERT INTO company_elearning_courses (company_id, course_id, is_enabled) VALUES
    (v_company_id, v_c1, true), (v_company_id, v_c2, true), (v_company_id, v_c3, true), (v_company_id, v_c4, true);

  INSERT INTO course_enrolments (employee_id, course_id, status, progress, enrolled_at, completed_at) VALUES
    (v_emp1, v_c1, 'completed',   100, NOW() - interval '30 days', NOW() - interval '28 days'),
    (v_emp1, v_c2, 'completed',   100, NOW() - interval '25 days', NOW() - interval '24 days'),
    (v_emp1, v_c3, 'in_progress',  60, NOW() - interval '5 days',  NULL),
    (v_emp2, v_c1, 'completed',   100, NOW() - interval '20 days', NOW() - interval '18 days'),
    (v_emp2, v_c2, 'in_progress',  40, NOW() - interval '3 days',  NULL),
    (v_emp3, v_c1, 'completed',   100, NOW() - interval '15 days', NOW() - interval '14 days'),
    (v_emp3, v_c3, 'completed',   100, NOW() - interval '10 days', NOW() - interval '9 days'),
    (v_emp4, v_c1, 'not_started',   0, NOW() - interval '2 days',  NULL),
    (v_emp5, v_c1, 'in_progress',  25, NOW() - interval '7 days',  NULL),
    (v_emp5, v_c4, 'not_started',   0, NOW() - interval '1 day',   NULL),
    (v_emp7, v_c1, 'completed',   100, NOW() - interval '12 days', NOW() - interval '11 days'),
    (v_emp7, v_c2, 'completed',   100, NOW() - interval '8 days',  NOW() - interval '7 days');

  -- ═══════════════════════════════════════════════════════════
  -- PERFORMANCE REVIEWS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO performance_reviews (employee_id, reviewer_id, review_type, review_period, overall_rating, strengths, areas_for_improvement, goals, status, review_date) VALUES
    (v_emp1, v_admin_employee_id, 'annual',     '2025-2026', 4, 'Excellent people management and process improvement', 'Could delegate more to team members', 'Complete CIPD Level 7 by Q4', 'completed', CURRENT_DATE - 30),
    (v_emp2, v_admin_employee_id, 'annual',     '2025-2026', 5, 'Outstanding technical skills and code quality',       'Could improve documentation practices', 'Lead the platform migration project', 'completed', CURRENT_DATE - 25),
    (v_emp3, v_admin_employee_id, 'annual',     '2025-2026', 4, 'Strong financial analysis and reporting',              'Needs to develop presentation skills', 'Automate monthly reporting by Q3', 'completed', CURRENT_DATE - 20),
    (v_emp4, v_admin_employee_id, 'mid_year',   '2026 H1',  3, 'Good operational oversight',                           'Time management could be improved',    'Reduce warehouse processing time by 15%', 'in_progress', NULL),
    (v_emp5, v_emp1,              'probation',  '2025 Q1',  4, 'Creative marketing campaigns with measurable results', 'Needs more experience with analytics', 'Launch social media strategy', 'completed', CURRENT_DATE - 60),
    (v_emp7, v_emp2,              'annual',     '2025-2026', 4, 'Solid engineering fundamentals',                       'Could contribute more in code reviews', 'Achieve AWS certification', 'completed', CURRENT_DATE - 15),
    (v_emp9, v_emp4,              'mid_year',   '2026 H1',  3, 'Reliable and thorough in inventory checks',            'Communication could be more proactive', 'Cross-train on forklift operations', 'in_progress', NULL);

  -- ═══════════════════════════════════════════════════════════
  -- ONBOARDING
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO onboarding (employee_id, step, status, completed_at, company_id) VALUES
    (v_emp5,  'contract_signed',   'completed',   NOW() - interval '90 days', v_company_id),
    (v_emp5,  'it_setup',          'completed',   NOW() - interval '88 days', v_company_id),
    (v_emp5,  'induction',         'completed',   NOW() - interval '85 days', v_company_id),
    (v_emp10, 'contract_signed',   'completed',   NOW() - interval '30 days', v_company_id),
    (v_emp10, 'it_setup',          'completed',   NOW() - interval '28 days', v_company_id),
    (v_emp10, 'induction',         'in_progress', NULL,                        v_company_id),
    (v_emp10, 'probation_review',  'pending',     NULL,                        v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- TIMESHEETS (last 2 weeks for fixed-pattern employees)
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO timesheets (employee_id, date, start_time, end_time, break_minutes, total_hours, status, company_id)
  SELECT e.id, d.dt,
    (d.dt || ' 09:00')::timestamptz,
    (d.dt || ' 17:30')::timestamptz,
    60, 7.5,
    CASE WHEN d.dt < CURRENT_DATE - 7 THEN 'approved' ELSE 'submitted' END,
    v_company_id
  FROM unnest(ARRAY[v_emp1, v_emp2, v_emp3, v_emp5, v_emp7]) AS e(id)
  CROSS JOIN generate_series(CURRENT_DATE - 13, CURRENT_DATE - 1, '1 day'::interval) AS d(dt)
  WHERE EXTRACT(DOW FROM d.dt) BETWEEN 1 AND 5;

  -- ═══════════════════════════════════════════════════════════
  -- SHIFTS & ROTAS (for variable-pattern employees)
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO rotas (name, start_date, end_date, status, company_id)
  VALUES ('Week ' || to_char(CURRENT_DATE, 'WW') || ' Rota', CURRENT_DATE - (EXTRACT(DOW FROM CURRENT_DATE)::int), CURRENT_DATE - (EXTRACT(DOW FROM CURRENT_DATE)::int) + 6, 'published', v_company_id)
  RETURNING id INTO v_rota1;

  INSERT INTO shift_templates (name, start_time, end_time, colour, company_id) VALUES
    ('Morning',   '06:00', '14:00', '#4caf50', v_company_id),
    ('Afternoon', '14:00', '22:00', '#2196f3', v_company_id),
    ('Night',     '22:00', '06:00', '#9c27b0', v_company_id);

  SELECT id INTO v_st_morning   FROM shift_templates WHERE name='Morning'   AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_st_afternoon FROM shift_templates WHERE name='Afternoon' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_st_night     FROM shift_templates WHERE name='Night'     AND company_id=v_company_id LIMIT 1;

  -- Assign shifts for variable employees over current week
  INSERT INTO shift_assignments (rota_id, employee_id, shift_template_id, date, company_id)
  SELECT v_rota1, e.id,
    CASE
      WHEN e.id IN (v_emp4, v_emp6) THEN v_st_morning
      WHEN e.id IN (v_emp8, v_emp10) THEN v_st_afternoon
      ELSE v_st_night
    END,
    d.dt, v_company_id
  FROM unnest(ARRAY[v_emp4, v_emp6, v_emp8, v_emp9, v_emp10]) AS e(id)
  CROSS JOIN generate_series(
    CURRENT_DATE - (EXTRACT(DOW FROM CURRENT_DATE)::int),
    CURRENT_DATE - (EXTRACT(DOW FROM CURRENT_DATE)::int) + 6,
    '1 day'::interval
  ) AS d(dt)
  WHERE EXTRACT(DOW FROM d.dt) BETWEEN 1 AND 5;

  -- ═══════════════════════════════════════════════════════════
  -- 1:1 MEETINGS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO one_to_one_meetings (employee_id, manager_id, scheduled_date, status, notes, company_id) VALUES
    (v_emp1, v_admin_employee_id, CURRENT_DATE - 7,  'completed',  'Discussed team expansion plans and Q3 targets.', v_company_id),
    (v_emp2, v_admin_employee_id, CURRENT_DATE - 3,  'completed',  'Reviewed sprint velocity and upcoming releases.', v_company_id),
    (v_emp5, v_admin_employee_id, CURRENT_DATE + 3,  'scheduled',  NULL, v_company_id),
    (v_emp6, v_emp1,              CURRENT_DATE - 5,  'completed',  'Onboarding progress review — settling in well.', v_company_id),
    (v_emp7, v_emp2,              CURRENT_DATE + 7,  'scheduled',  NULL, v_company_id);

  SELECT id INTO v_mtg1 FROM one_to_one_meetings WHERE employee_id=v_emp1 AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_mtg2 FROM one_to_one_meetings WHERE employee_id=v_emp2 AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_mtg3 FROM one_to_one_meetings WHERE employee_id=v_emp6 AND company_id=v_company_id LIMIT 1;

  INSERT INTO one_to_one_comments (meeting_id, author_id, comment, company_id) VALUES
    (v_mtg1, v_admin_employee_id, 'Looking to hire two more engineers by end of Q3.', v_company_id),
    (v_mtg1, v_emp1, 'Agreed — I will draft the job descriptions this week.', v_company_id),
    (v_mtg2, v_emp2, 'Sprint velocity has increased 20% since we adopted the new workflow.', v_company_id),
    (v_mtg3, v_emp1, 'Lucy is progressing well — recommend extending probation review to 6 months as standard.', v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- SKILLS PASSPORT
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO skill_categories (name, description, company_id) VALUES
    ('Technical',  'Programming languages, frameworks, and tools', v_company_id),
    ('Soft Skills', 'Communication, leadership, and teamwork',     v_company_id),
    ('Compliance', 'Regulatory and legal requirements',            v_company_id);

  SELECT id INTO v_scat1 FROM skill_categories WHERE name='Technical'  AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_scat2 FROM skill_categories WHERE name='Soft Skills' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_scat3 FROM skill_categories WHERE name='Compliance' AND company_id=v_company_id LIMIT 1;

  INSERT INTO skills (name, category_id, description, company_id) VALUES
    ('JavaScript',   v_scat1, 'Frontend and backend JavaScript development', v_company_id),
    ('SQL',          v_scat1, 'Database design and query writing',           v_company_id),
    ('React',        v_scat1, 'React component development',                v_company_id),
    ('Leadership',   v_scat2, 'Team leadership and mentoring',              v_company_id),
    ('Presentation', v_scat2, 'Public speaking and presentation skills',    v_company_id),
    ('UK GDPR',      v_scat3, 'UK data protection compliance',              v_company_id)
  RETURNING id INTO v_skill1;

  SELECT id INTO v_skill1 FROM skills WHERE name='JavaScript' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_skill2 FROM skills WHERE name='SQL'         AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_skill3 FROM skills WHERE name='React'       AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_skill4 FROM skills WHERE name='Leadership'  AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_skill5 FROM skills WHERE name='Presentation' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_skill6 FROM skills WHERE name='UK GDPR'     AND company_id=v_company_id LIMIT 1;

  INSERT INTO employee_skills (employee_id, skill_id, proficiency_level, company_id) VALUES
    (v_emp2, v_skill1, 5, v_company_id), (v_emp2, v_skill2, 4, v_company_id), (v_emp2, v_skill3, 5, v_company_id),
    (v_emp7, v_skill1, 4, v_company_id), (v_emp7, v_skill3, 3, v_company_id),
    (v_emp1, v_skill4, 4, v_company_id), (v_emp1, v_skill5, 3, v_company_id), (v_emp1, v_skill6, 5, v_company_id),
    (v_emp3, v_skill2, 4, v_company_id), (v_emp3, v_skill5, 3, v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- SPACE BOOKING
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO locations (name, address, company_id)
  VALUES ('Head Office', '123 Business Park, London EC1A 1BB', v_company_id)
  RETURNING id INTO v_loc1;

  INSERT INTO floors (name, location_id, company_id)
  VALUES ('Ground Floor', v_loc1, v_company_id)
  RETURNING id INTO v_floor1;

  INSERT INTO spaces (name, floor_id, type, capacity, amenities, is_active, company_id) VALUES
    ('Meeting Room A', v_floor1, 'meeting_room', 8,  '["Projector","Whiteboard","Video Conferencing"]', true, v_company_id),
    ('Hot Desk Zone',  v_floor1, 'hot_desk',     20, '["Monitor","Keyboard","Mouse"]',                  true, v_company_id),
    ('Quiet Room',     v_floor1, 'focus_room',   4,  '["Soundproofing","Standing Desk"]',               true, v_company_id);

  SELECT id INTO v_space1 FROM spaces WHERE name='Meeting Room A' AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_space2 FROM spaces WHERE name='Hot Desk Zone'  AND company_id=v_company_id LIMIT 1;
  SELECT id INTO v_space3 FROM spaces WHERE name='Quiet Room'     AND company_id=v_company_id LIMIT 1;

  INSERT INTO space_bookings (space_id, employee_id, date, start_time, end_time, status, company_id) VALUES
    (v_space1, v_emp1, CURRENT_DATE + 1, '10:00', '11:00', 'confirmed', v_company_id),
    (v_space1, v_emp2, CURRENT_DATE + 1, '14:00', '15:30', 'confirmed', v_company_id),
    (v_space2, v_emp5, CURRENT_DATE + 2, '09:00', '17:00', 'confirmed', v_company_id),
    (v_space3, v_emp7, CURRENT_DATE + 1, '09:00', '12:00', 'confirmed', v_company_id),
    (v_space2, v_emp3, CURRENT_DATE + 3, '09:00', '17:00', 'pending',   v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- SURVEYS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO company_surveys (company_id, title, description, banner_colour, questions, status)
  VALUES (v_company_id, 'Employee Satisfaction Survey', 'Help us understand how you feel about working here', '#4F46E5',
    '[{"id":"q1","type":"rating","text":"How satisfied are you with your role?","required":true},{"id":"q2","type":"text","text":"What could we improve?","required":false},{"id":"q3","type":"rating","text":"How would you rate team collaboration?","required":true}]',
    'active')
  RETURNING id INTO v_survey1;

  INSERT INTO survey_deployments (company_id, survey_id, title, start_date, end_date, target_audience, status)
  VALUES (v_company_id, v_survey1, 'Q3 Satisfaction Check', CURRENT_DATE - 7, CURRENT_DATE + 21, 'all', 'active')
  RETURNING id INTO v_deploy1;

  INSERT INTO survey_responses (company_id, deployment_id, employee_id, answers, submitted_at) VALUES
    (v_company_id, v_deploy1, v_emp1, '{"q1":4,"q2":"More flexible working options would be great","q3":5}', NOW() - interval '5 days'),
    (v_company_id, v_deploy1, v_emp2, '{"q1":5,"q2":"Happy with everything!","q3":4}', NOW() - interval '4 days'),
    (v_company_id, v_deploy1, v_emp3, '{"q1":3,"q2":"Would appreciate more team social events","q3":3}', NOW() - interval '3 days'),
    (v_company_id, v_deploy1, v_emp7, '{"q1":4,"q2":"","q3":4}', NOW() - interval '2 days');

  -- ═══════════════════════════════════════════════════════════
  -- NOTIFICATIONS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO notifications (employee_id, type, title, message, is_read, company_id) VALUES
    (v_admin_employee_id, 'leave',    'Leave request pending',          'James Wilson has requested 5 days annual leave',        false, v_company_id),
    (v_admin_employee_id, 'leave',    'Leave request pending',          'Tom Richards has requested 5 days annual leave',        false, v_company_id),
    (v_admin_employee_id, 'leave',    'Leave request pending',          'Lucy Bennett has requested 5 days annual leave',        false, v_company_id),
    (v_admin_employee_id, 'expense',  'Expense claim submitted',       'James Wilson submitted expense EXP-T-002 for £85.50',   false, v_company_id),
    (v_emp1,              'kudos',    'You received kudos!',            'Emma Thompson recognised your leadership',              false, v_company_id),
    (v_emp2,              'leave',    'Leave request approved',         'Your leave request for 14-16 has been approved',        true,  v_company_id),
    (v_emp5,              'course',   'Course assigned',                'Data Protection & GDPR has been assigned to you',       false, v_company_id),
    (v_emp7,              'kudos',    'You received kudos!',            'James Wilson recognised your code review feedback',     false, v_company_id),
    (v_emp9,              'shift',    'Shift assigned',                 'You have been assigned to Night shift this week',       true,  v_company_id),
    (v_emp10,             'onboard',  'Onboarding: Induction pending', 'Please complete your induction checklist',              false, v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- WORKFLOW TRACKER
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO workflow_tracker (employee_id, action_type, approval_type, approval_id, status, company_id) VALUES
    (v_emp2,  'leave_request',  'leave', v_lr1, 'pending',  v_company_id),
    (v_emp4,  'leave_request',  'leave', v_lr2, 'pending',  v_company_id),
    (v_emp6,  'leave_request',  'leave', v_lr3, 'pending',  v_company_id),
    (v_emp2,  'expense_claim',  'expense', v_claim2, 'pending', v_company_id);

  -- ═══════════════════════════════════════════════════════════
  -- APP SETTINGS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO app_settings (company_id, dashboard_style, default_view)
  VALUES (v_company_id, 'classic', 'dashboard')
  ON CONFLICT (company_id) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════
  -- COMPANY FEATURES (all enabled at zero cost for trial)
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO company_features (company_id, feature_key, is_enabled, custom_price) VALUES
    (v_company_id, 'hr_core',             true, 0),
    (v_company_id, 'expenses',            true, 0),
    (v_company_id, 'leave',               true, 0),
    (v_company_id, 'payslips',            true, 0),
    (v_company_id, 'kudos',              true, 0),
    (v_company_id, 'benefits',            true, 0),
    (v_company_id, 'elearning',           true, 0),
    (v_company_id, 'performance',         true, 0),
    (v_company_id, 'timesheets',          true, 0),
    (v_company_id, 'shifts',             true, 0),
    (v_company_id, 'legal_timesheets',    true, 0),
    (v_company_id, 'space_booking',       true, 0),
    (v_company_id, 'asset_management',    true, 0),
    (v_company_id, 'skills_passport',     true, 0),
    (v_company_id, 'email_notifications', true, 0),
    (v_company_id, 'teams_integration',   true, 0),
    (v_company_id, 'xero_integration',    true, 0),
    (v_company_id, 'sage_integration',    true, 0),
    (v_company_id, 'surveys',            true, 0),
    (v_company_id, 'pack_a',             true, 0),
    (v_company_id, 'pack_b',             true, 0);

  -- ═══════════════════════════════════════════════════════════
  -- UPDATE TRIAL REQUEST WITH CREDENTIALS
  -- ═══════════════════════════════════════════════════════════

  UPDATE trial_requests SET
    status = 'approved',
    company_name = trim(p_company_name),
    company_id = v_company_id,
    admin_password = v_admin_password,
    employee_email = 'demo1@' || v_slug || '-trial.example.com',
    employee_password = v_emp_password,
    processed_at = NOW(),
    processed_by = auth.uid()
  WHERE id = p_request_id;

  RETURN json_build_object(
    'success', true,
    'company_id', v_company_id,
    'company_name', trim(p_company_name),
    'admin_email', v_request.work_email,
    'admin_password', v_admin_password,
    'employee_email', 'demo1@' || v_slug || '-trial.example.com',
    'employee_password', v_emp_password,
    'trial_end_date', (CURRENT_DATE + 14)::text,
    'employees_created', 11
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_trial_data(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_trial_data(UUID, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3. Drop old demo seed RPC
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.run_demo_seed(uuid);
