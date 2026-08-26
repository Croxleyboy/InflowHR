-- ============================================================================
-- INFLOWHR VOLUME TEST SEED — 500 EMPLOYEES
-- Run this against your Supabase database to create a test company with
-- 500 employees and proportional transaction data across all features.
-- Company ID: 99999999-9999-9999-9999-999999999999
--
-- IMPORTANT: Run with RLS disabled (use the Supabase SQL Editor which runs
-- as postgres / service_role, or wrap in ALTER TABLE … DISABLE RLS blocks).
-- company_users are NOT seeded because they reference auth.users — employees
-- will appear in admin views but won't be individually login-able.
-- ============================================================================

DO $$
DECLARE
  v_co uuid := '99999999-9999-9999-9999-999999999999';
  v_emp_ids uuid[];
  v_mgr_ids uuid[];
  v_emp_id uuid;
  v_mgr_id uuid;
  v_dept text;
  v_depts text[] := ARRAY['Engineering','Sales','Marketing','Finance','HR','Operations','Legal','Customer Support'];
  v_first_m text[] := ARRAY['James','Oliver','William','Jack','Harry','Thomas','George','Charlie','Oscar','Archie','Leo','Henry','Alfie','Joshua','Freddie','Ethan','Isaac','Alexander','Joseph','Samuel','Daniel','Adam','Edward','Ryan','Max','Benjamin','Lucas','Jake','Noah','Jacob','Dylan','Liam','Matthew','Nathan','Callum','Jamie','Luke','Aaron','Connor','David','Robert','Michael','Andrew','Peter','Mark','Simon','Paul','Richard'];
  v_first_f text[] := ARRAY['Olivia','Amelia','Isla','Emily','Jessica','Sophie','Grace','Lily','Mia','Ava','Freya','Ella','Charlotte','Daisy','Poppy','Isabella','Rosie','Ruby','Alice','Florence','Sophia','Lucy','Phoebe','Eva','Evie','Scarlett','Chloe','Hannah','Emma','Molly','Holly','Georgia','Ellie','Amber','Katie','Beth','Lauren','Rachel','Sarah','Laura','Megan','Rebecca','Victoria','Natasha','Claire','Helen','Zoe','Anna'];
  v_last text[] := ARRAY['Smith','Jones','Williams','Taylor','Brown','Davies','Evans','Wilson','Thomas','Johnson','Roberts','Walker','Wright','Thompson','White','Hughes','Edwards','Green','Hall','Lewis','Harris','Clark','Robinson','Mitchell','Young','King','Lee','Martin','Wood','Jackson','Turner','Hill','Moore','Anderson','Baker','Campbell','Carter','Cooper','Kelly','Morgan','Murray','Phillips','Price','Reid','Scott','Stewart','Ward','Watson','Bell','Brooks'];
  v_titles_eng text[] := ARRAY['Software Engineer','Senior Developer','DevOps Engineer','QA Engineer','Frontend Developer','Backend Developer','Data Engineer','Platform Engineer'];
  v_titles_sales text[] := ARRAY['Sales Executive','Account Manager','Business Development Rep','Sales Coordinator','Inside Sales Rep','Sales Analyst'];
  v_titles_mkt text[] := ARRAY['Marketing Executive','Content Manager','Digital Marketing Specialist','SEO Analyst','Brand Manager','Marketing Coordinator'];
  v_titles_fin text[] := ARRAY['Financial Analyst','Accountant','Payroll Specialist','Tax Analyst','Accounts Payable Clerk','Budget Analyst'];
  v_titles_hr text[] := ARRAY['HR Advisor','Recruitment Specialist','People Operations Lead','HR Administrator','Talent Acquisition Manager'];
  v_titles_ops text[] := ARRAY['Operations Coordinator','Project Manager','Business Analyst','Process Improvement Lead','Supply Chain Analyst'];
  v_titles_leg text[] := ARRAY['Legal Counsel','Paralegal','Compliance Officer','Contract Manager','Legal Analyst'];
  v_titles_cs text[] := ARRAY['Support Agent','Customer Success Manager','Technical Support Engineer','Help Desk Analyst','Support Coordinator'];
  v_locations text[] := ARRAY['London HQ','Manchester Office','Birmingham Office','Leeds Office','Edinburgh Office','Bristol Office','Remote'];
  v_first text;
  v_lastname text;
  v_email text;
  v_jobtitle text;
  v_loc text;
  v_gender text;
  i int;
  j int;
  v_lt_annual bigint;
  v_lt_sick bigint;
  v_leave_id bigint;
  v_exp_id bigint;
  v_meeting_id int;
  v_goal_id uuid;
  v_rota_id uuid;
  v_tmpl_id uuid;
  v_space_ids uuid[];
  v_space_id uuid;
  v_location_id uuid;
  v_floor_id uuid;
  v_d date;
  v_status text;
  v_cat text;
  v_cats text[] := ARRAY['teamwork','innovation','leadership','customer_focus','going_above'];
  v_exp_cats text[] := ARRAY['Travel','Meals','Accommodation','Equipment','Training','Software','Office Supplies'];
  v_ticket_cats text[] := ARRAY['hr-query','payroll','leave','onboarding','system-access','benefits','user-request','other'];
  v_priorities text[] := ARRAY['low','medium','high','urgent'];
  v_fy_start date := '2025-04-01';
  v_fy_end date := '2026-03-31';
  v_rand float;
  v_dept_idx int;
  v_emp_count int := 0;
  v_dept_mgr_ids uuid[];
BEGIN
  -- ═══════════════════════════════════════════════════════════
  -- 1. COMPANY
  -- ═══════════════════════════════════════════════════════════
  INSERT INTO companies (id, name, microsoft_tenant_id, domain, is_active, fy_start_month)
  VALUES (v_co, 'Volume Test Corp', 'volume-test-tenant-id', 'volumetest.inflowhr.com', true, 4)
  ON CONFLICT (id) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════
  -- 2. EMPLOYEES (500 — first 8 are dept managers, next 12 team leads)
  -- ═══════════════════════════════════════════════════════════
  v_mgr_ids := ARRAY[]::uuid[];
  v_emp_ids := ARRAY[]::uuid[];
  v_dept_mgr_ids := ARRAY[]::uuid[];

  -- 8 department managers
  FOR i IN 1..8 LOOP
    v_emp_id := gen_random_uuid();
    v_dept := v_depts[i];
    v_first := v_first_m[1 + (i * 5) % array_length(v_first_m, 1)];
    v_lastname := v_last[1 + (i * 7) % array_length(v_last, 1)];
    v_email := lower(v_first) || '.' || lower(v_lastname) || '.mgr@volumetest.inflowhr.com';

    INSERT INTO employees (id, first_name, last_name, email, job_title, department, is_active, is_admin, company_id, start_date, employee_number, phone, gender, nationality, location)
    VALUES (v_emp_id, v_first, v_lastname, v_email,
      CASE v_dept
        WHEN 'Engineering' THEN 'Engineering Manager'
        WHEN 'Sales' THEN 'Sales Director'
        WHEN 'Marketing' THEN 'Marketing Manager'
        WHEN 'Finance' THEN 'Finance Manager'
        WHEN 'HR' THEN 'HR Manager'
        WHEN 'Operations' THEN 'Operations Manager'
        WHEN 'Legal' THEN 'Legal Counsel'
        WHEN 'Customer Support' THEN 'Support Team Lead'
      END,
      v_dept, true, (i = 5), v_co, ('2022-01-01'::date + (i * 30)),
      'VT-M' || lpad(i::text, 3, '0'),
      '07' || lpad((7000000 + i * 111111)::text, 9, '0'),
      CASE WHEN i % 2 = 0 THEN 'Female' ELSE 'Male' END,
      'British', v_locations[1 + (i % array_length(v_locations, 1))]
    );

    v_mgr_ids := array_append(v_mgr_ids, v_emp_id);
    v_dept_mgr_ids := array_append(v_dept_mgr_ids, v_emp_id);
    v_emp_ids := array_append(v_emp_ids, v_emp_id);
    v_emp_count := v_emp_count + 1;
  END LOOP;

  -- 12 team leads
  FOR i IN 1..12 LOOP
    v_emp_id := gen_random_uuid();
    v_dept_idx := CASE
      WHEN i <= 4 THEN 1
      WHEN i <= 6 THEN 2
      WHEN i <= 8 THEN 6
      WHEN i <= 10 THEN 8
      ELSE 1 + (i % 8)
    END;
    v_dept := v_depts[v_dept_idx];
    v_first := v_first_f[1 + (i * 3) % array_length(v_first_f, 1)];
    v_lastname := v_last[1 + (i * 11) % array_length(v_last, 1)];
    v_email := lower(v_first) || '.' || lower(v_lastname) || '.lead@volumetest.inflowhr.com';

    INSERT INTO employees (id, first_name, last_name, email, job_title, department, manager_id, is_active, is_admin, company_id, start_date, employee_number, phone, gender, nationality, location)
    VALUES (v_emp_id, v_first, v_lastname, v_email, 'Team Lead', v_dept,
      v_dept_mgr_ids[v_dept_idx], true, false, v_co, ('2022-06-01'::date + (i * 45)),
      'VT-L' || lpad(i::text, 3, '0'),
      '07' || lpad((8000000 + i * 111111)::text, 9, '0'),
      CASE WHEN i % 2 = 0 THEN 'Male' ELSE 'Female' END,
      'British', v_locations[1 + (i % array_length(v_locations, 1))]
    );

    v_mgr_ids := array_append(v_mgr_ids, v_emp_id);
    v_emp_ids := array_append(v_emp_ids, v_emp_id);
    v_emp_count := v_emp_count + 1;
  END LOOP;

  -- 480 regular employees
  FOR i IN 1..480 LOOP
    v_emp_id := gen_random_uuid();
    v_rand := random();
    IF v_rand < 0.256 THEN v_dept_idx := 1;
    ELSIF v_rand < 0.398 THEN v_dept_idx := 2;
    ELSIF v_rand < 0.500 THEN v_dept_idx := 3;
    ELSIF v_rand < 0.598 THEN v_dept_idx := 4;
    ELSIF v_rand < 0.696 THEN v_dept_idx := 5;
    ELSIF v_rand < 0.826 THEN v_dept_idx := 6;
    ELSIF v_rand < 0.874 THEN v_dept_idx := 7;
    ELSE v_dept_idx := 8;
    END IF;
    v_dept := v_depts[v_dept_idx];

    IF random() < 0.5 THEN
      v_first := v_first_m[1 + (i * 7 + 3) % array_length(v_first_m, 1)];
      v_gender := 'Male';
    ELSE
      v_first := v_first_f[1 + (i * 7 + 3) % array_length(v_first_f, 1)];
      v_gender := 'Female';
    END IF;
    v_lastname := v_last[1 + (i * 13 + 5) % array_length(v_last, 1)];
    v_email := lower(v_first) || '.' || lower(v_lastname) || '.' || i::text || '@volumetest.inflowhr.com';
    v_loc := v_locations[1 + (i % array_length(v_locations, 1))];
    v_mgr_id := v_mgr_ids[1 + (i % array_length(v_mgr_ids, 1))];

    v_jobtitle := CASE v_dept_idx
      WHEN 1 THEN v_titles_eng[1 + (i % array_length(v_titles_eng, 1))]
      WHEN 2 THEN v_titles_sales[1 + (i % array_length(v_titles_sales, 1))]
      WHEN 3 THEN v_titles_mkt[1 + (i % array_length(v_titles_mkt, 1))]
      WHEN 4 THEN v_titles_fin[1 + (i % array_length(v_titles_fin, 1))]
      WHEN 5 THEN v_titles_hr[1 + (i % array_length(v_titles_hr, 1))]
      WHEN 6 THEN v_titles_ops[1 + (i % array_length(v_titles_ops, 1))]
      WHEN 7 THEN v_titles_leg[1 + (i % array_length(v_titles_leg, 1))]
      WHEN 8 THEN v_titles_cs[1 + (i % array_length(v_titles_cs, 1))]
    END;

    INSERT INTO employees (id, first_name, last_name, email, job_title, department, manager_id, is_active, is_admin, company_id, start_date, employee_number, phone, gender, nationality, location)
    VALUES (v_emp_id, v_first, v_lastname, v_email, v_jobtitle, v_dept, v_mgr_id, true, false, v_co,
      ('2023-01-01'::date + (i * 2 + (i % 30))),
      'VT-' || lpad((i + 20)::text, 4, '0'),
      '07' || lpad((1000000 + i * 1337)::text, 9, '0'),
      v_gender,
      CASE WHEN i % 10 = 0 THEN 'Irish' WHEN i % 15 = 0 THEN 'Indian' WHEN i % 20 = 0 THEN 'Polish' ELSE 'British' END,
      v_loc
    );

    v_emp_ids := array_append(v_emp_ids, v_emp_id);
    v_emp_count := v_emp_count + 1;
  END LOOP;

  RAISE NOTICE 'Created % employees', v_emp_count;

  -- ═══════════════════════════════════════════════════════════
  -- 3. APP SETTINGS
  -- ═══════════════════════════════════════════════════════════
  INSERT INTO app_settings (company_id, language, financial_year_start_month, country_code)
  VALUES (v_co, 'en', 4, 'GB')
  ON CONFLICT DO NOTHING;

  -- ═══════════════════════════════════════════════════════════
  -- 4. LEAVE TYPES + BALANCES
  -- ═══════════════════════════════════════════════════════════
  INSERT INTO leave_types (name, default_allowance, colour, is_active, company_id, deducts_from_allowance, max_carry_over_days) VALUES
    ('Annual Leave', 25, '#5b9bd5', true, v_co, true, 5),
    ('Sick Leave', 10, '#e53935', true, v_co, false, 0),
    ('Jury Duty', 5, '#ff9800', true, v_co, false, 0),
    ('Bereavement', 5, '#78909c', true, v_co, true, 0),
    ('Exam Leave', 5, '#7e57c2', true, v_co, true, 0),
    ('Carers Leave', 5, '#ef6c00', true, v_co, true, 0);

  SELECT id INTO v_lt_annual FROM leave_types WHERE name='Annual Leave' AND company_id=v_co LIMIT 1;
  SELECT id INTO v_lt_sick FROM leave_types WHERE name='Sick Leave' AND company_id=v_co LIMIT 1;

  FOR i IN 1..array_length(v_emp_ids, 1) LOOP
    INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over, company_id) VALUES
      (v_emp_ids[i], v_lt_annual, 2025, 25, (random() * 15)::int, (random() * 3)::int, v_co),
      (v_emp_ids[i], v_lt_sick, 2025, 10, (random() * 4)::int, 0, v_co);
  END LOOP;

  RAISE NOTICE 'Created leave types and % balances', array_length(v_emp_ids, 1) * 2;

  -- ═══════════════════════════════════════════════════════════
  -- 5. LEAVE REQUESTS (~2000)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..2000 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_d := v_fy_start + (random() * 365)::int;
    v_status := CASE (random() * 4)::int
      WHEN 0 THEN 'pending' WHEN 1 THEN 'approved' WHEN 2 THEN 'approved' WHEN 3 THEN 'approved' ELSE 'rejected'
    END;
    INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, status, reason, company_id, created_at)
    VALUES (v_emp_id, v_lt_annual, v_d, v_d + (1 + (random() * 4)::int), 1 + (random() * 4)::int, v_status,
      CASE WHEN random() < 0.3 THEN 'Holiday' WHEN random() < 0.6 THEN 'Family commitment' ELSE NULL END,
      v_co, (v_d - (random() * 14)::int)::timestamp);
  END LOOP;

  RAISE NOTICE 'Created 2000 leave requests';

  -- ═══════════════════════════════════════════════════════════
  -- 6. EXPENSE CLAIMS + LINE ITEMS (~1200)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..1200 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_d := v_fy_start + (random() * 365)::int;
    v_status := CASE (random() * 4)::int
      WHEN 0 THEN 'pending' WHEN 1 THEN 'approved' WHEN 2 THEN 'approved' ELSE 'submitted'
    END;
    v_cat := v_exp_cats[1 + (i % array_length(v_exp_cats, 1))];

    INSERT INTO expense_claims (employee_id, reference_number, title, amount, currency, status, category, company_id, submitted_at, created_at)
    VALUES (v_emp_id, 'VT-EXP-' || lpad(i::text, 5, '0'),
      v_cat || ' expense', (10 + random() * 490)::numeric(10,2), 'GBP', v_status, v_cat, v_co,
      v_d::timestamp, v_d::timestamp)
    RETURNING id INTO v_exp_id;

    FOR j IN 1..(1 + (random() * 2)::int) LOOP
      INSERT INTO expense_line_items (expense_claim_id, title, expense_type, amount, date_of_purchase, company_id, created_at)
      VALUES (v_exp_id, v_cat || ' item ' || j, v_cat, (5 + random() * 200)::numeric(10,2), v_d, v_co, v_d::timestamp);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Created 1200 expense claims with line items';

  -- ═══════════════════════════════════════════════════════════
  -- 7. PAYSLIPS (~3000 — 6 months × 500)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..array_length(v_emp_ids, 1) LOOP
    FOR j IN 0..5 LOOP
      v_d := ('2025-04-28'::date + (j * 30));
      INSERT INTO payslips (employee_id, reference_number, gross_pay, tax, national_insurance, pension, net_pay, status, payment_date, pay_period_start, pay_period_end, company_id, created_at)
      VALUES (v_emp_ids[i], 'VT-PAY-' || i || '-' || j,
        (2500 + random() * 3000)::numeric(10,2),
        (500 + random() * 800)::numeric(10,2),
        (200 + random() * 400)::numeric(10,2),
        (100 + random() * 300)::numeric(10,2),
        (1500 + random() * 2000)::numeric(10,2),
        'paid', v_d,
        (v_d - 29), v_d, v_co, v_d::timestamp);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Created % payslips', array_length(v_emp_ids, 1) * 6;

  -- ═══════════════════════════════════════════════════════════
  -- 8. KUDOS (~1500)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..1500 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_mgr_id := v_emp_ids[1 + ((i * 7) % array_length(v_emp_ids, 1))];
    IF v_emp_id = v_mgr_id THEN
      v_mgr_id := v_emp_ids[1 + ((i * 7 + 1) % array_length(v_emp_ids, 1))];
    END IF;
    v_d := v_fy_start + (random() * 365)::int;
    v_cat := v_cats[1 + (i % array_length(v_cats, 1))];

    INSERT INTO kudos (from_employee_id, to_employee_id, message, category, is_public, company_id, created_at)
    VALUES (v_mgr_id, v_emp_id,
      CASE v_cat
        WHEN 'teamwork' THEN 'Great collaboration on the project delivery!'
        WHEN 'innovation' THEN 'Brilliant idea that improved our workflow.'
        WHEN 'leadership' THEN 'Excellent leadership during a challenging sprint.'
        WHEN 'customer_focus' THEN 'Outstanding customer service — client was very impressed.'
        ELSE 'Went above and beyond to meet the deadline. Thank you!'
      END,
      v_cat, random() > 0.2, v_co, v_d::timestamp);
  END LOOP;

  RAISE NOTICE 'Created 1500 kudos';

  -- ═══════════════════════════════════════════════════════════
  -- 9. TIMESHEETS (~5000)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..5000 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_d := v_fy_start + (random() * 300)::int;
    v_status := CASE (random() * 3)::int
      WHEN 0 THEN 'draft' WHEN 1 THEN 'pending' ELSE 'approved'
    END;

    INSERT INTO timesheets (employee_id, location, customer, role, date, start_time, end_time, end_date, status, company_id, created_at)
    VALUES (v_emp_id,
      v_locations[1 + (i % array_length(v_locations, 1))],
      'Client ' || (1 + (i % 20))::text,
      'Standard', v_d, '09:00'::time, '17:30'::time, v_d, v_status, v_co, v_d::timestamp);
  END LOOP;

  RAISE NOTICE 'Created 5000 timesheets';

  -- ═══════════════════════════════════════════════════════════
  -- 10. ONE-TO-ONE MEETINGS + COMMENTS (~2000)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..2000 LOOP
    v_emp_id := v_emp_ids[20 + (i % (array_length(v_emp_ids, 1) - 20))];
    v_mgr_id := v_mgr_ids[1 + (i % array_length(v_mgr_ids, 1))];
    v_d := v_fy_start + (random() * 365)::int;
    v_status := CASE (random() * 5)::int
      WHEN 0 THEN 'pending' WHEN 1 THEN 'accepted' WHEN 2 THEN 'completed'
      WHEN 3 THEN 'completed' ELSE 'completed'
    END;

    INSERT INTO one_to_one_meetings (manager_id, employee_id, scheduled_date, scheduled_time, status, summary, company_id, created_at)
    VALUES (v_mgr_id, v_emp_id, v_d,
      CASE (i % 4) WHEN 0 THEN '09:00:00' WHEN 1 THEN '10:30:00' WHEN 2 THEN '14:00:00' ELSE '15:30:00' END,
      v_status,
      CASE WHEN v_status = 'completed' AND random() > 0.3 THEN 'Discussed progress, goals, and development opportunities.' ELSE NULL END,
      v_co, (v_d - 7)::timestamp)
    RETURNING id INTO v_meeting_id;

    IF v_status = 'completed' AND random() > 0.5 THEN
      INSERT INTO one_to_one_comments (meeting_id, author_id, body, company_id, created_at)
      VALUES (v_meeting_id, v_mgr_id, 'Follow up on action items from previous meeting.', v_co, v_d::timestamp);
    END IF;
  END LOOP;

  RAISE NOTICE 'Created 2000 one-to-one meetings';

  -- ═══════════════════════════════════════════════════════════
  -- 11. PERFORMANCE GOALS + COMMENTS (~800)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..800 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_mgr_id := CASE WHEN random() > 0.3 THEN v_mgr_ids[1 + (i % array_length(v_mgr_ids, 1))] ELSE NULL END;
    v_d := v_fy_start + (random() * 180)::int;
    v_status := CASE (random() * 5)::int
      WHEN 0 THEN 'active' WHEN 1 THEN 'active' WHEN 2 THEN 'completed'
      WHEN 3 THEN 'on_hold' ELSE 'active'
    END;
    v_goal_id := gen_random_uuid();

    INSERT INTO performance_goals (id, company_id, employee_id, manager_id, title, description, status, grade, start_date, due_date, completed_at, created_at, updated_at)
    VALUES (v_goal_id, v_co, v_emp_id, v_mgr_id,
      CASE (i % 8)
        WHEN 0 THEN 'Complete certification training'
        WHEN 1 THEN 'Improve code review turnaround'
        WHEN 2 THEN 'Lead Q3 client project'
        WHEN 3 THEN 'Reduce support ticket backlog'
        WHEN 4 THEN 'Mentor a junior team member'
        WHEN 5 THEN 'Deliver quarterly presentation'
        WHEN 6 THEN 'Streamline onboarding process'
        ELSE 'Achieve sales target for H2'
      END,
      'Detailed goal description with measurable outcomes and timeline.',
      v_status,
      CASE WHEN v_status = 'completed' THEN (5 + (random() * 5)::int) ELSE NULL END,
      v_d, v_d + 90,
      CASE WHEN v_status = 'completed' THEN (v_d + (60 + (random() * 30)::int))::timestamp ELSE NULL END,
      v_d::timestamp, v_d::timestamp);

    IF random() > 0.6 THEN
      INSERT INTO performance_goal_comments (goal_id, author_id, body, company_id, created_at)
      VALUES (v_goal_id, COALESCE(v_mgr_id, v_emp_id), 'Good progress so far. Keep it up.', v_co, (v_d + 30)::timestamp);
    END IF;
  END LOOP;

  RAISE NOTICE 'Created 800 performance goals';

  -- ═══════════════════════════════════════════════════════════
  -- 12. PERFORMANCE REVIEWS (~400)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..400 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_mgr_id := v_mgr_ids[1 + (i % array_length(v_mgr_ids, 1))];
    v_status := CASE (random() * 3)::int WHEN 0 THEN 'draft' WHEN 1 THEN 'in_progress' ELSE 'completed' END;

    INSERT INTO performance_reviews (employee_id, reviewer_id, review_period, overall_rating, strengths, areas_for_improvement, goals, status, company_id, created_at, completed_at)
    VALUES (v_emp_id, v_mgr_id, '2025/2026', (2 + (random() * 3)::int),
      'Strong team player with excellent technical skills.',
      'Could improve on time management and delegation.',
      'Focus on leadership development in Q3.',
      v_status, v_co, v_fy_start::timestamp,
      CASE WHEN v_status = 'completed' THEN (v_fy_start + (random() * 200)::int)::timestamp ELSE NULL END);
  END LOOP;

  RAISE NOTICE 'Created 400 performance reviews';

  -- ═══════════════════════════════════════════════════════════
  -- 13. SPACE MANAGEMENT (locations, floors, spaces, bookings)
  -- ═══════════════════════════════════════════════════════════
  v_location_id := gen_random_uuid();
  INSERT INTO locations (id, company_id, name, address, is_active, sort_order)
  VALUES (v_location_id, v_co, 'London HQ', '100 Canary Wharf, London E14 5AB', true, 1);

  v_floor_id := gen_random_uuid();
  INSERT INTO floors (id, location_id, company_id, name, sort_order)
  VALUES (v_floor_id, v_location_id, v_co, 'Floor 3', 1);

  v_space_ids := ARRAY[]::uuid[];
  FOR i IN 1..10 LOOP
    v_space_id := gen_random_uuid();
    INSERT INTO spaces (id, company_id, floor_id, name, space_type, capacity, status, sort_order)
    VALUES (v_space_id, v_co, v_floor_id,
      CASE WHEN i <= 5 THEN 'Desk ' || i WHEN i <= 8 THEN 'Meeting Room ' || (i-5) ELSE 'Phone Booth ' || (i-8) END,
      CASE WHEN i <= 5 THEN 'desk' WHEN i <= 8 THEN 'meeting_room' ELSE 'phone_booth' END,
      CASE WHEN i <= 5 THEN 1 WHEN i <= 8 THEN (4 + i) ELSE 1 END,
      'available', i);
    v_space_ids := array_append(v_space_ids, v_space_id);
  END LOOP;

  INSERT INTO space_settings (company_id, max_advance_days, auto_cancel_no_checkin, auto_cancel_minutes, buffer_minutes, default_slot_minutes)
  VALUES (v_co, 30, true, 15, 5, 60);

  FOR i IN 1..2500 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_space_id := v_space_ids[1 + (i % array_length(v_space_ids, 1))];
    v_d := v_fy_start + (random() * 365)::int;
    v_status := CASE (random() * 3)::int WHEN 0 THEN 'confirmed' WHEN 1 THEN 'checked_in' ELSE 'confirmed' END;

    BEGIN
      INSERT INTO space_bookings (company_id, space_id, employee_id, booking_date, start_time, end_time, title, status, created_at)
      VALUES (v_co, v_space_id, v_emp_id, v_d,
        ('08:00'::time + ((i % 8) * interval '1 hour')),
        ('09:00'::time + ((i % 8) * interval '1 hour')),
        'Booking', v_status, v_d::timestamp);
    EXCEPTION WHEN exclusion_violation OR unique_violation THEN
      NULL;
    END;
  END LOOP;

  RAISE NOTICE 'Created space bookings';

  -- ═══════════════════════════════════════════════════════════
  -- 14. ANNOUNCEMENTS (~20)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..20 LOOP
    v_d := v_fy_start + (i * 18);
    INSERT INTO announcements (title, body, author_id, is_pinned, published_at, company_id, created_at)
    VALUES (
      CASE (i % 5)
        WHEN 0 THEN 'Office update — new facilities available'
        WHEN 1 THEN 'Q' || (1 + (i % 4)) || ' company results'
        WHEN 2 THEN 'Upcoming team building event'
        WHEN 3 THEN 'Policy update — remote working guidelines'
        ELSE 'Welcome to our new starters this month!'
      END,
      'Please read the full details and reach out to HR with any questions.',
      v_mgr_ids[1 + (i % array_length(v_mgr_ids, 1))],
      (i <= 3), v_d::timestamp, v_co, v_d::timestamp);
  END LOOP;

  RAISE NOTICE 'Created 20 announcements';

  -- ═══════════════════════════════════════════════════════════
  -- 15. NOTIFICATIONS (~2500)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..2500 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_d := v_fy_start + (random() * 365)::int;

    INSERT INTO notifications (employee_id, title, message, type, is_read, company_id, created_at)
    VALUES (v_emp_id,
      CASE (i % 6)
        WHEN 0 THEN 'Leave request approved'
        WHEN 1 THEN 'New kudos received'
        WHEN 2 THEN 'Expense claim processed'
        WHEN 3 THEN 'Meeting scheduled'
        WHEN 4 THEN 'Timesheet reminder'
        ELSE 'New announcement posted'
      END,
      'Please check your dashboard for details.',
      CASE (i % 3) WHEN 0 THEN 'info' WHEN 1 THEN 'action' ELSE 'alert' END,
      (random() > 0.4), v_co, v_d::timestamp);
  END LOOP;

  RAISE NOTICE 'Created 2500 notifications';

  -- ═══════════════════════════════════════════════════════════
  -- 16. HR TICKETS (~100)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..100 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_d := v_fy_start + (random() * 365)::int;

    INSERT INTO hr_tickets (company_id, ref, title, description, category, priority, status, submitted_by, created_at)
    VALUES (v_co, 'VT-TKT-' || lpad(i::text, 4, '0'),
      CASE (i % 8)
        WHEN 0 THEN 'Payslip query for last month'
        WHEN 1 THEN 'Request for flexible working'
        WHEN 2 THEN 'Leave balance discrepancy'
        WHEN 3 THEN 'System access request'
        WHEN 4 THEN 'Benefits enrolment question'
        WHEN 5 THEN 'Parking permit request'
        WHEN 6 THEN 'Training budget approval'
        ELSE 'General HR enquiry'
      END,
      'Detailed description of the issue requiring HR attention.',
      v_ticket_cats[1 + (i % array_length(v_ticket_cats, 1))],
      v_priorities[1 + (i % array_length(v_priorities, 1))],
      CASE (random() * 4)::int WHEN 0 THEN 'open' WHEN 1 THEN 'in_progress' WHEN 2 THEN 'resolved' ELSE 'closed' END,
      'Employee ' || (i % 500 + 1),
      v_d::timestamp);
  END LOOP;

  RAISE NOTICE 'Created 100 HR tickets';

  -- ═══════════════════════════════════════════════════════════
  -- 17. WORKFLOW TRACKER (~1000)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..1000 LOOP
    v_emp_id := v_emp_ids[1 + (i % array_length(v_emp_ids, 1))];
    v_d := v_fy_start + (random() * 365)::int;

    INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, reminder_count, task_description, approval_status, company_id, created_at)
    VALUES ('Employee ' || (i % 500 + 1), 1,
      CASE (random() * 3)::int WHEN 0 THEN 'Pending' WHEN 1 THEN 'Complete' ELSE 'Complete' END,
      CASE (i % 4) WHEN 0 THEN 'Leave' WHEN 1 THEN 'Expense' WHEN 2 THEN 'Meeting' ELSE 'Onboarding' END,
      'Approval required',
      'emp' || i || '@volumetest.inflowhr.com',
      'mgr' || (i % 20) || '@volumetest.inflowhr.com',
      1, 'Review and approve pending request.',
      CASE (random() * 3)::int WHEN 0 THEN 'Pending' WHEN 1 THEN 'Approved' ELSE 'Declined' END,
      v_co, v_d::timestamp);
  END LOOP;

  RAISE NOTICE 'Created 1000 workflow tracker entries';

  -- ═══════════════════════════════════════════════════════════
  -- 18. SHIFT MANAGEMENT (templates, rotas, assignments)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..4 LOOP
    v_tmpl_id := gen_random_uuid();
    INSERT INTO shift_templates (id, company_id, name, start_time, end_time, break_minutes, colour, is_active)
    VALUES (v_tmpl_id, v_co,
      CASE i WHEN 1 THEN 'Early' WHEN 2 THEN 'Standard' WHEN 3 THEN 'Late' ELSE 'Night' END,
      CASE i WHEN 1 THEN '06:00' WHEN 2 THEN '09:00' WHEN 3 THEN '14:00' ELSE '22:00' END,
      CASE i WHEN 1 THEN '14:00' WHEN 2 THEN '17:30' WHEN 3 THEN '22:00' ELSE '06:00' END,
      CASE i WHEN 2 THEN 60 ELSE 30 END,
      CASE i WHEN 1 THEN '#f59e0b' WHEN 2 THEN '#3b82f6' WHEN 3 THEN '#8b5cf6' ELSE '#1f2937' END,
      true);
  END LOOP;

  FOR i IN 1..4 LOOP
    v_rota_id := gen_random_uuid();
    v_d := v_fy_start + ((i - 1) * 90);
    INSERT INTO rotas (id, company_id, name, start_date, end_date, department, status, created_at)
    VALUES (v_rota_id, v_co,
      'Q' || i || ' Rota — Operations',
      v_d, v_d + 89, 'Operations',
      CASE WHEN i <= 2 THEN 'published' ELSE 'draft' END,
      v_d::timestamp);

    FOR j IN 1..200 LOOP
      v_emp_id := v_emp_ids[1 + (j % array_length(v_emp_ids, 1))];
      BEGIN
        INSERT INTO shift_assignments (company_id, rota_id, employee_id, date, notes)
        VALUES (v_co, v_rota_id, v_emp_id, v_d + (j % 89), NULL);
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Created shift templates, rotas, and assignments';

  -- ═══════════════════════════════════════════════════════════
  -- 19. ONBOARDING RECORDS (~50)
  -- ═══════════════════════════════════════════════════════════
  FOR i IN 1..50 LOOP
    v_emp_id := v_emp_ids[array_length(v_emp_ids, 1) - 50 + i];
    v_d := v_fy_start + (random() * 200)::int;

    INSERT INTO onboarding (user_action, status, firstname, surname, start_date, user_email, job_title, employee_number, department, manager, contract_type, location, company_id, employee_id, is_complete, appstatus, initial_setup_complete, created_at)
    VALUES ('Joiner',
      CASE (random() * 3)::int WHEN 0 THEN 'new' WHEN 1 THEN 'in_progress' ELSE 'complete' END,
      'New', 'Starter ' || i, v_d,
      'newstarter' || i || '@volumetest.inflowhr.com',
      'Graduate Analyst', 'VT-NEW-' || lpad(i::text, 3, '0'),
      v_depts[1 + (i % 8)], 'A Manager', 'Full Time',
      v_locations[1 + (i % array_length(v_locations, 1))],
      v_co, v_emp_id, (random() > 0.5), 'active', (random() > 0.5),
      v_d::timestamp);
  END LOOP;

  RAISE NOTICE 'Created 50 onboarding records';

  RAISE NOTICE '══════════════════════════════════════════════';
  RAISE NOTICE 'VOLUME SEED COMPLETE — Company: Volume Test Corp';
  RAISE NOTICE 'Company ID: %', v_co;
  RAISE NOTICE 'Employees: 500 (8 dept managers + 12 team leads + 480 staff)';
  RAISE NOTICE 'Leave requests: 2000 | Expenses: 1200 | Payslips: 3000';
  RAISE NOTICE 'Kudos: 1500 | Timesheets: 5000 | 1:1 meetings: 2000';
  RAISE NOTICE 'Goals: 800 | Reviews: 400 | Space bookings: ~2500';
  RAISE NOTICE 'HR tickets: 100 | Notifications: 2500 | Announcements: 20';
  RAISE NOTICE 'Workflow entries: 1000 | Shift assignments: ~800';
  RAISE NOTICE 'Onboarding: 50';
  RAISE NOTICE '══════════════════════════════════════════════';
END $$;
