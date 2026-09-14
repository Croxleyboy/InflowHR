-- ============================================================
-- 094 — SMB Launch Readiness
--
-- 2.1  Salary/payroll RLS isolation
-- 2.3  Service admin pre-authorisation
-- 2.5  Receipts bucket tenant-scoped storage policies
-- 4.1  Data retention cron scheduling
-- 4.2  Clear plaintext temp passwords
-- 4.4  Employee consents table (religion, geolocation, data processing)
-- ============================================================

-- ============================================================
-- 2.1 — SALARY / PAYROLL RLS ISOLATION
-- ============================================================

-- Helper: does the current user have payroll permission in their portal role?
CREATE OR REPLACE FUNCTION has_payroll_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin_portal_access apa
    JOIN admin_portal_roles apr ON apr.company_id = apa.company_id AND apr.role_key = apa.role_key
    JOIN employees e ON e.id = apa.employee_id
    WHERE e.auth_user_id = auth.uid()
      AND apa.company_id = p_company_id
      AND (apr.permissions->>'payroll')::boolean = true
  )
  OR is_company_admin()
  OR is_super_admin();
$$;

-- Helper: get the current user's employee ID
CREATE OR REPLACE FUNCTION get_my_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM employees
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- Create a secure view that masks sensitive columns for non-payroll users.
-- Employees can always see their own salary/bank data.
-- Users with payroll access or admin/super_admin see everything.
CREATE OR REPLACE VIEW employees_secure AS
SELECT
  e.id, e.company_id, e.auth_user_id, e.first_name, e.last_name, e.email,
  e.personal_email, e.phone, e.contract_type, e.department, e.job_title,
  e.start_date, e.is_active, e.avatar_url,
  e.employee_number, e.manager_name, e.manager_email,
  e.date_of_birth, e.gender, e.nationality, e.marital_status, e.religion,
  e.address_line1, e.address_line2, e.city, e.county, e.postcode, e.country,
  e.emergency_contact_name, e.emergency_contact_phone, e.emergency_contact_relationship,
  e.salary_group,
  -- Sensitive payroll/financial fields: masked unless own record, payroll access, or admin
  CASE
    WHEN e.auth_user_id = auth.uid() THEN e.annual_salary
    WHEN has_payroll_access(e.company_id) THEN e.annual_salary
    ELSE NULL
  END AS annual_salary,
  CASE
    WHEN e.auth_user_id = auth.uid() THEN e.ni_number
    WHEN has_payroll_access(e.company_id) THEN e.ni_number
    ELSE NULL
  END AS ni_number,
  CASE
    WHEN e.auth_user_id = auth.uid() THEN e.bank_sort_code
    WHEN has_payroll_access(e.company_id) THEN e.bank_sort_code
    ELSE NULL
  END AS bank_sort_code,
  CASE
    WHEN e.auth_user_id = auth.uid() THEN e.bank_account_number
    WHEN has_payroll_access(e.company_id) THEN e.bank_account_number
    ELSE NULL
  END AS bank_account_number,
  CASE
    WHEN e.auth_user_id = auth.uid() THEN e.bank_account_name
    WHEN has_payroll_access(e.company_id) THEN e.bank_account_name
    ELSE NULL
  END AS bank_account_name,
  CASE
    WHEN e.auth_user_id = auth.uid() THEN e.tax_code
    WHEN has_payroll_access(e.company_id) THEN e.tax_code
    ELSE NULL
  END AS tax_code,
  CASE
    WHEN e.auth_user_id = auth.uid() THEN e.payroll_id
    WHEN has_payroll_access(e.company_id) THEN e.payroll_id
    ELSE NULL
  END AS payroll_id,
  e.created_at, e.updated_at,
  e.anonymised_at, e.anonymised_by
FROM employees e;

-- Payslips: employees can only read their own. Admin/payroll users read all in company.
DROP POLICY IF EXISTS "Company scoped read" ON payslips;
DROP POLICY IF EXISTS "Employees can read own payslips" ON payslips;

CREATE POLICY "Payslips scoped read" ON payslips FOR SELECT
  USING (
    can_access_company(company_id)
    AND (
      employee_id = get_my_employee_id()
      OR has_payroll_access(company_id)
    )
  );


-- ============================================================
-- 2.3 — SERVICE ADMIN PRE-AUTHORISATION
-- ============================================================

-- Add support_access_authorised column to companies table
-- Company admins set this during onboarding; super admin can only
-- self-grant 48h access when this is true.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS support_access_authorised boolean NOT NULL DEFAULT false;

-- Replace ensure_super_admin_access to check pre-authorisation
CREATE OR REPLACE FUNCTION ensure_super_admin_access()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sa_uid uuid;
  v_company record;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can call this function';
  END IF;

  v_sa_uid := auth.uid();

  -- Expire any stale grants first
  UPDATE tenant_support_access
  SET status = 'expired'
  WHERE granted_to = v_sa_uid
    AND status = 'active'
    AND expires_at < now();

  -- Grant 48h access to companies that have pre-authorised support access
  FOR v_company IN
    SELECT id FROM companies WHERE support_access_authorised = true
  LOOP
    -- Skip if already has active grant
    IF EXISTS (
      SELECT 1 FROM tenant_support_access
      WHERE company_id = v_company.id
        AND granted_to = v_sa_uid
        AND status = 'active'
        AND expires_at > now()
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO tenant_support_access (
      company_id, granted_by, granted_to,
      scope, reason, expires_at, status
    ) VALUES (
      v_company.id, v_sa_uid, v_sa_uid,
      'read_only', 'Pre-authorised support access',
      now() + interval '48 hours', 'active'
    );

    -- Audit log the self-grant
    PERFORM log_gdpr_action(
      v_sa_uid, 'super_admin', v_company.id,
      NULL, 'tenant_support_access', NULL,
      'SELF_GRANT_ACCESS', NULL, NULL,
      jsonb_build_object(
        'scope', 'read_only',
        'reason', 'Pre-authorised support access',
        'expires_at', (now() + interval '48 hours')::text,
        'pre_authorised', true
      )
    );
  END LOOP;
END;
$$;


-- ============================================================
-- 2.5 — RECEIPTS BUCKET TENANT-SCOPED STORAGE POLICIES
-- ============================================================

-- Drop existing over-permissive storage policies on receipts bucket
DROP POLICY IF EXISTS "Authenticated users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete own receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update receipts" ON storage.objects;

-- Tenant-scoped: file path must start with user's company_id
CREATE POLICY "Tenant scoped receipt upload" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] IN (
      SELECT cu.company_id::text FROM company_users cu
      WHERE cu.auth_user_id = auth.uid() AND cu.is_active = true
    )
  );

CREATE POLICY "Tenant scoped receipt read" ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] IN (
      SELECT cu.company_id::text FROM company_users cu
      WHERE cu.auth_user_id = auth.uid() AND cu.is_active = true
    )
  );

CREATE POLICY "Tenant scoped receipt update" ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] IN (
      SELECT cu.company_id::text FROM company_users cu
      WHERE cu.auth_user_id = auth.uid() AND cu.is_active = true
    )
  );

CREATE POLICY "Tenant scoped receipt delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] IN (
      SELECT cu.company_id::text FROM company_users cu
      WHERE cu.auth_user_id = auth.uid() AND cu.is_active = true
    )
  );


-- ============================================================
-- 4.4 — EMPLOYEE CONSENTS TABLE
-- ============================================================

CREATE TABLE employee_consents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN (
    'data_processing', 'geolocation', 'special_category', 'marketing'
  )),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  consent_version TEXT NOT NULL DEFAULT '1.0',
  ip_address TEXT,
  user_agent TEXT,
  UNIQUE(employee_id, consent_type)
);

ALTER TABLE employee_consents ENABLE ROW LEVEL SECURITY;

-- Employees can read/manage their own consents; admins can read company consents
CREATE POLICY "Own consents read" ON employee_consents FOR SELECT
  USING (
    employee_id = get_my_employee_id()
    OR (can_access_company(company_id) AND is_company_admin())
    OR is_super_admin()
  );

CREATE POLICY "Own consents insert" ON employee_consents FOR INSERT
  WITH CHECK (employee_id = get_my_employee_id());

CREATE POLICY "Own consents update" ON employee_consents FOR UPDATE
  USING (employee_id = get_my_employee_id());


-- ============================================================
-- 4.2 — CLEAR PLAINTEXT TEMPORARY PASSWORDS
-- ============================================================

-- Null out any existing temp passwords where the auth user has been created
UPDATE onboarding o
SET temporary_password = NULL
WHERE o.temporary_password IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = o.employee_id
      AND e.auth_user_id IS NOT NULL
  );

-- Create a trigger to auto-clear temp password when employee gets linked to auth user
CREATE OR REPLACE FUNCTION clear_temp_password_on_auth_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL AND (OLD.auth_user_id IS NULL OR OLD.auth_user_id != NEW.auth_user_id) THEN
    UPDATE onboarding SET temporary_password = NULL WHERE employee_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_temp_password ON employees;
CREATE TRIGGER trg_clear_temp_password
  AFTER UPDATE OF auth_user_id ON employees
  FOR EACH ROW
  EXECUTE FUNCTION clear_temp_password_on_auth_link();


-- ============================================================
-- 4.1 — DATA RETENTION CRON SCHEDULING
-- ============================================================

-- Cleanup notifications older than 90 days
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM notifications
  WHERE created_at < now() - interval '90 days'
    AND is_read = true;
END;
$$;

-- Cleanup geolocation data older than 12 months (null out coordinates, keep the check-in record)
CREATE OR REPLACE FUNCTION cleanup_old_geolocation_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE checkin_records
  SET check_in_lat = NULL,
      check_in_lng = NULL,
      check_out_lat = NULL,
      check_out_lng = NULL
  WHERE created_at < now() - interval '12 months'
    AND (check_in_lat IS NOT NULL OR check_out_lat IS NOT NULL);
END;
$$;

-- Schedule all retention jobs via pg_cron (if extension available)
-- These run daily at 03:00 UTC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Purge expired frozen employees (30-day offboarding queue)
    PERFORM cron.schedule(
      'purge-frozen-employees',
      '0 3 * * *',
      'SELECT purge_expired_frozen_employees()'
    );

    -- Expire stale support grants
    PERFORM cron.schedule(
      'expire-support-grants',
      '5 3 * * *',
      'SELECT expire_stale_support_grants()'
    );

    -- Clean up old read notifications
    PERFORM cron.schedule(
      'cleanup-old-notifications',
      '10 3 * * *',
      'SELECT cleanup_old_notifications()'
    );

    -- Anonymise old geolocation data
    PERFORM cron.schedule(
      'cleanup-old-geolocation',
      '15 3 * * *',
      'SELECT cleanup_old_geolocation_data()'
    );
  END IF;
END $$;


-- ============================================================
-- 2.2 — SSO ENFORCEMENT FLAG
-- ============================================================

-- Mark non-SSO as testing mode on the companies table
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS auth_mode_note TEXT;

-- Update existing non-SSO companies to be flagged as testing
UPDATE companies
SET auth_mode_note = 'testing-only'
WHERE auth_mode = 'nonsso';
