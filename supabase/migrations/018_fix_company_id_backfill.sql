-- ============================================================
-- Fix multi-tenant data: backfill company_id + auto-set trigger
-- ============================================================

-- 1. Backfill all existing rows with the Kumonix company_id
DO $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT id INTO v_company_id FROM companies WHERE domain = 'kumonix.com' LIMIT 1;

  IF v_company_id IS NOT NULL THEN
    UPDATE employees        SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE expense_claims   SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE expense_line_items SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE leave_requests   SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE leave_balances   SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE leave_types      SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE onboarding       SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE kudos            SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE announcements    SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE payslips         SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE workflow_tracker SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE notifications    SET company_id = v_company_id WHERE company_id IS NULL;
    UPDATE app_settings     SET company_id = v_company_id WHERE company_id IS NULL;
  END IF;
END $$;

-- 2. Auto-set company_id on INSERT so app code doesn't need to pass it
CREATE OR REPLACE FUNCTION auto_set_company_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := get_my_company_id();
  END IF;
  RETURN NEW;
END;
$$;

-- Apply trigger to all tenant-scoped tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'employees', 'expense_claims', 'expense_line_items',
    'leave_requests', 'leave_balances', 'leave_types',
    'onboarding', 'kudos', 'announcements', 'payslips',
    'workflow_tracker', 'notifications', 'app_settings'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS auto_company_id ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER auto_company_id BEFORE INSERT ON %I
       FOR EACH ROW EXECUTE FUNCTION auto_set_company_id()',
      tbl
    );
  END LOOP;
END $$;

-- 3. Fix companies RLS: admins can see ALL companies (needed for AdminCompanies page)
DROP POLICY IF EXISTS "Users can view own company" ON companies;
CREATE POLICY "Users can view own company"
  ON companies FOR SELECT
  USING (id = get_my_company_id() OR is_company_admin());

-- Admins can insert new companies
CREATE POLICY "Admins can insert companies"
  ON companies FOR INSERT
  WITH CHECK (is_company_admin());

-- Admins can update any company
CREATE POLICY "Admins can update companies"
  ON companies FOR UPDATE
  USING (is_company_admin());

-- Admins can delete companies (except their own — enforced in app)
CREATE POLICY "Admins can delete companies"
  ON companies FOR DELETE
  USING (is_company_admin());

-- 4. Fix company_users: admins need to manage users across companies
DROP POLICY IF EXISTS "Users can view own company users" ON company_users;
CREATE POLICY "Users can view company users"
  ON company_users FOR SELECT
  USING (company_id = get_my_company_id() OR is_company_admin());

-- Admins can delete company_users for any company
CREATE POLICY "Admins can delete company users"
  ON company_users FOR DELETE
  USING (is_company_admin());
