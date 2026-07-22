-- ============================================
-- InflowHR Database Schema
-- Run this in Supabase SQL Editor (supabase.com > SQL Editor > New Query)
-- ============================================

-- ── Employees (core table, referenced by all features) ──
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id),
  employee_number TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  job_title TEXT,
  department TEXT,
  manager_id UUID REFERENCES employees(id),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  phone TEXT,
  avatar_url TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Expense Claims ──
CREATE TABLE expense_claims (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  reference_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  category TEXT,
  receipt_url TEXT,
  submitted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Leave / Time Off ──
CREATE TABLE leave_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  default_allowance INTEGER NOT NULL DEFAULT 25,
  colour TEXT DEFAULT '#4caf50',
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE leave_balances (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  leave_type_id BIGINT NOT NULL REFERENCES leave_types(id),
  year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  total_allowance INTEGER NOT NULL DEFAULT 25,
  used INTEGER NOT NULL DEFAULT 0,
  carried_over INTEGER NOT NULL DEFAULT 0,
  UNIQUE (employee_id, leave_type_id, year)
);

CREATE TABLE leave_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  leave_type_id BIGINT NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_requested DECIMAL(4,1) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason TEXT,
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Payslips ──
CREATE TABLE payslips (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  reference_number TEXT UNIQUE NOT NULL,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  gross_pay DECIMAL(10,2) NOT NULL,
  tax DECIMAL(10,2) NOT NULL DEFAULT 0,
  national_insurance DECIMAL(10,2) NOT NULL DEFAULT 0,
  pension DECIMAL(10,2) NOT NULL DEFAULT 0,
  other_deductions DECIMAL(10,2) NOT NULL DEFAULT 0,
  net_pay DECIMAL(10,2) NOT NULL,
  payment_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('draft', 'processed', 'paid')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Kudos ──
CREATE TABLE kudos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_employee_id UUID NOT NULL REFERENCES employees(id),
  to_employee_id UUID NOT NULL REFERENCES employees(id),
  message TEXT NOT NULL,
  category TEXT CHECK (category IN ('teamwork', 'innovation', 'leadership', 'customer_focus', 'going_above')),
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Benefits ──
CREATE TABLE benefits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  provider TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employee_benefits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  benefit_id BIGINT NOT NULL REFERENCES benefits(id),
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'cancelled')),
  UNIQUE (employee_id, benefit_id)
);

-- ── E-Learning ──
CREATE TABLE courses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  duration_minutes INTEGER,
  is_mandatory BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE course_enrolments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  course_id BIGINT NOT NULL REFERENCES courses(id),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  score INTEGER,
  UNIQUE (employee_id, course_id)
);

-- ── Performance ──
CREATE TABLE performance_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  reviewer_id UUID NOT NULL REFERENCES employees(id),
  review_period TEXT NOT NULL,
  overall_rating INTEGER CHECK (overall_rating BETWEEN 1 AND 5),
  strengths TEXT,
  areas_for_improvement TEXT,
  goals TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Company Announcements ──
CREATE TABLE announcements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id UUID REFERENCES employees(id),
  is_pinned BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Notifications ──
CREATE TABLE notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  title TEXT NOT NULL,
  message TEXT,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'action', 'alert')),
  link TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── App Settings (feature toggles, language per user) ──
CREATE TABLE user_settings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID UNIQUE NOT NULL REFERENCES employees(id),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'de')),
  features_config JSONB NOT NULL DEFAULT '{
    "expenses": true,
    "leave": true,
    "profile": true,
    "payslips": true,
    "kudos": true,
    "benefits": true,
    "elearning": true,
    "performance": true
  }'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================
-- Enable Row Level Security on all tables
-- ============================================
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE kudos ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;


-- ============================================
-- Basic RLS policies (allow authenticated read)
-- You can tighten these later per feature
-- ============================================
CREATE POLICY "Authenticated users can read employees"
  ON employees FOR SELECT TO authenticated USING (true);

CREATE POLICY "Employees can read own expense claims"
  ON expense_claims FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Employees can insert own expense claims"
  ON expense_claims FOR INSERT TO authenticated
  WITH CHECK (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Employees can update own draft expense claims"
  ON expense_claims FOR UPDATE TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()) AND status = 'draft');

CREATE POLICY "Authenticated users can read leave types"
  ON leave_types FOR SELECT TO authenticated USING (true);

CREATE POLICY "Employees can read own leave balances"
  ON leave_balances FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Employees can read own leave requests"
  ON leave_requests FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Employees can insert own leave requests"
  ON leave_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Employees can read own payslips"
  ON payslips FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Authenticated users can read public kudos"
  ON kudos FOR SELECT TO authenticated USING (is_public = true);

CREATE POLICY "Authenticated users can insert kudos"
  ON kudos FOR INSERT TO authenticated
  WITH CHECK (from_employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Authenticated users can read benefits"
  ON benefits FOR SELECT TO authenticated USING (true);

CREATE POLICY "Employees can read own benefit enrolments"
  ON employee_benefits FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Authenticated users can read courses"
  ON courses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Employees can read own course enrolments"
  ON course_enrolments FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Employees can read own performance reviews"
  ON performance_reviews FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Authenticated users can read announcements"
  ON announcements FOR SELECT TO authenticated USING (true);

CREATE POLICY "Employees can read own notifications"
  ON notifications FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Employees can read own settings"
  ON user_settings FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Employees can upsert own settings"
  ON user_settings FOR INSERT TO authenticated
  WITH CHECK (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));

CREATE POLICY "Employees can update own settings"
  ON user_settings FOR UPDATE TO authenticated
  USING (employee_id IN (SELECT id FROM employees WHERE auth_user_id = auth.uid()));
