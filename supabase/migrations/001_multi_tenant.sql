-- ============================================================
-- Multi-Tenant SSO Migration
-- Adds company isolation to all tables
-- ============================================================

-- 1. Companies table
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  microsoft_tenant_id text UNIQUE NOT NULL,
  domain text,
  logo_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. Company users (links auth.users → companies → employees)
CREATE TABLE IF NOT EXISTS company_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id),
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee', 'hr')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(auth_user_id, company_id)
);

-- 3. Add company_id to all existing tables
ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE expense_claims ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE expense_line_items ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE kudos ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE workflow_tracker ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);

-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_company_users_auth ON company_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_company_users_company ON company_users(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_expense_claims_company ON expense_claims(company_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company ON leave_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_company ON onboarding(company_id);
CREATE INDEX IF NOT EXISTS idx_kudos_company ON kudos(company_id);
CREATE INDEX IF NOT EXISTS idx_announcements_company ON announcements(company_id);
CREATE INDEX IF NOT EXISTS idx_payslips_company ON payslips(company_id);
CREATE INDEX IF NOT EXISTS idx_workflow_tracker_company ON workflow_tracker(company_id);
CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id);

-- 5. Helper function: get current user's company_id
CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT company_id
  FROM company_users
  WHERE auth_user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

-- 6. Helper function: check if current user is admin
CREATE OR REPLACE FUNCTION is_company_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE auth_user_id = auth.uid()
      AND is_active = true
      AND role IN ('admin', 'hr')
  );
$$;

-- ============================================================
-- 7. Row Level Security Policies
-- ============================================================

-- Enable RLS on new tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_users ENABLE ROW LEVEL SECURITY;

-- Companies: users can only see their own company
CREATE POLICY "Users can view own company"
  ON companies FOR SELECT
  USING (id = get_my_company_id());

-- Company users: users can see colleagues in their company
CREATE POLICY "Users can view own company users"
  ON company_users FOR SELECT
  USING (company_id = get_my_company_id());

-- Admin can manage company users
CREATE POLICY "Admins can insert company users"
  ON company_users FOR INSERT
  WITH CHECK (company_id = get_my_company_id() AND is_company_admin());

CREATE POLICY "Admins can update company users"
  ON company_users FOR UPDATE
  USING (company_id = get_my_company_id() AND is_company_admin());

-- Employees
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON employees
  FOR ALL USING (company_id = get_my_company_id());

-- Expense claims
ALTER TABLE expense_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON expense_claims
  FOR ALL USING (company_id = get_my_company_id());

-- Expense line items
ALTER TABLE expense_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON expense_line_items
  FOR ALL USING (company_id = get_my_company_id());

-- Leave requests
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON leave_requests
  FOR ALL USING (company_id = get_my_company_id());

-- Leave balances
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON leave_balances
  FOR ALL USING (company_id = get_my_company_id());

-- Leave types
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON leave_types
  FOR ALL USING (company_id = get_my_company_id());

-- Onboarding
ALTER TABLE onboarding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON onboarding
  FOR ALL USING (company_id = get_my_company_id());

-- Kudos
ALTER TABLE kudos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON kudos
  FOR ALL USING (company_id = get_my_company_id());

-- Announcements
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON announcements
  FOR ALL USING (company_id = get_my_company_id());

-- Payslips
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON payslips
  FOR ALL USING (company_id = get_my_company_id());

-- Workflow tracker
ALTER TABLE workflow_tracker ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON workflow_tracker
  FOR ALL USING (company_id = get_my_company_id());

-- Notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON notifications
  FOR ALL USING (company_id = get_my_company_id());

-- App settings
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON app_settings
  FOR ALL USING (company_id = get_my_company_id());

-- ============================================================
-- 8. Auto-registration function
-- Called after a user signs in via Microsoft SSO for the first time.
-- Looks up or creates their company from the Microsoft tenant_id,
-- then creates a company_users record linking them.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_sso_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id text;
  v_company_id uuid;
  v_email text;
  v_full_name text;
  v_is_first_user boolean;
BEGIN
  -- Extract Microsoft tenant ID from the auth metadata
  v_tenant_id := NEW.raw_app_meta_data ->> 'provider_id';
  IF v_tenant_id IS NULL THEN
    v_tenant_id := NEW.raw_user_meta_data ->> 'iss';
  END IF;

  v_email := NEW.email;
  v_full_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', '');

  -- If no tenant_id, skip (non-SSO user)
  IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
    RETURN NEW;
  END IF;

  -- Look up existing company
  SELECT id INTO v_company_id
  FROM companies
  WHERE microsoft_tenant_id = v_tenant_id;

  -- If company doesn't exist yet, create it
  IF v_company_id IS NULL THEN
    v_is_first_user := true;
    INSERT INTO companies (name, microsoft_tenant_id, domain)
    VALUES (
      split_part(v_email, '@', 2),
      v_tenant_id,
      split_part(v_email, '@', 2)
    )
    RETURNING id INTO v_company_id;
  ELSE
    v_is_first_user := false;
  END IF;

  -- Create company_users link (first user becomes admin)
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

-- Trigger on new user creation
DROP TRIGGER IF EXISTS on_auth_user_created_sso ON auth.users;
CREATE TRIGGER on_auth_user_created_sso
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_sso_user();
