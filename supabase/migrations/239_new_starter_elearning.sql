-- ============================================================
-- Migration 239: New Starter E-Learning, Announcements Targeting,
--                Identity Provider Settings
-- ============================================================

-- ============================================================
-- 1a. E-learning columns
-- ============================================================

ALTER TABLE elearning_courses
  ADD COLUMN IF NOT EXISTS is_new_starter_course BOOLEAN DEFAULT false;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS new_starter_elearning_enabled BOOLEAN DEFAULT false;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS new_starter_course_id TEXT DEFAULT NULL;

-- ============================================================
-- 1b. Announcement targeting columns
-- ============================================================

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_employee_id UUID REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_departments TEXT[] DEFAULT NULL;

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS is_system_generated BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_announcements_target
  ON announcements(company_id, target_employee_id);

CREATE INDEX IF NOT EXISTS idx_announcements_departments
  ON announcements USING GIN (target_departments);

-- ============================================================
-- 1c. Update RLS on announcements — department + employee targeting
-- ============================================================

DROP POLICY IF EXISTS "Tenant isolation" ON announcements;
DROP POLICY IF EXISTS "Authenticated users can read announcements" ON announcements;

CREATE POLICY "announcements_read" ON announcements FOR SELECT TO authenticated USING (
  company_id = get_my_company_id()
  AND (
    (target_employee_id IS NULL AND (target_departments IS NULL OR target_departments = '{}'))
    OR (target_departments IS NOT NULL AND target_departments != '{}'
        AND EXISTS (
          SELECT 1 FROM employees e
          WHERE e.id = get_my_employee_id()
            AND e.department = ANY(target_departments)
        ))
    OR target_employee_id = get_my_employee_id()
    OR is_company_admin()
    OR is_super_admin()
  )
);

-- ============================================================
-- 1d. Audit table for automated new-starter announcements
-- ============================================================

CREATE TABLE IF NOT EXISTS new_starter_announcement_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  announcement_id BIGINT REFERENCES announcements(id) ON DELETE SET NULL,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'deleted')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE new_starter_announcement_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_read" ON new_starter_announcement_audit
  FOR SELECT TO authenticated USING (
    (company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin()
  );

CREATE POLICY "audit_insert" ON new_starter_announcement_audit
  FOR INSERT TO authenticated WITH CHECK (
    is_super_admin()
  );

CREATE INDEX IF NOT EXISTS idx_ns_audit_company
  ON new_starter_announcement_audit(company_id, created_at DESC);

-- ============================================================
-- 1e. Daily cron job: process_new_starter_announcements
-- ============================================================

CREATE OR REPLACE FUNCTION process_new_starter_announcements()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r RECORD;
  v_ann_id BIGINT;
  v_company RECORD;
BEGIN
  -- 1. Create welcome announcements for today's new starters
  FOR v_company IN
    SELECT c.id AS company_id, c.new_starter_course_id,
           co.name AS company_name
    FROM companies c
    LEFT JOIN companies co ON co.id = c.id
    WHERE c.new_starter_elearning_enabled = true
  LOOP
    FOR r IN
      SELECT e.id AS employee_id, e.first_name, e.last_name, e.company_id
      FROM employees e
      JOIN onboarding o ON o.user_email = e.email AND o.company_id = e.company_id
      WHERE e.company_id = v_company.company_id
        AND o.start_date = CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM announcements a
          WHERE a.target_employee_id = e.id
            AND a.is_system_generated = true
            AND a.company_id = e.company_id
        )
    LOOP
      INSERT INTO announcements (
        title, body, company_id, target_employee_id, is_system_generated,
        priority, is_pinned, published_at
      ) VALUES (
        'Welcome to the Team, ' || r.first_name || '!',
        'Welcome to the company! Here are a few things to get you started:' || chr(10) || chr(10) ||
        '1. Check out the Employee User Guide — it covers everything from booking leave to viewing your payslips.' || chr(10) ||
        '2. Complete your assigned e-learning courses — you have 7 days from your start date to finish them.' || chr(10) ||
        '3. Explore the HR app to update your profile, view company announcements, and connect with your team.' || chr(10) || chr(10) ||
        'If you have any questions, use the Help Chat or speak to your manager. Good luck!',
        r.company_id,
        r.employee_id,
        true,
        'high',
        false,
        now()
      )
      RETURNING id INTO v_ann_id;

      INSERT INTO new_starter_announcement_audit (
        company_id, announcement_id, employee_id, action
      ) VALUES (
        r.company_id, v_ann_id, r.employee_id, 'created'
      );
    END LOOP;
  END LOOP;

  -- 2. Delete system-generated announcements older than 14 days
  FOR r IN
    DELETE FROM announcements
    WHERE is_system_generated = true
      AND published_at < now() - INTERVAL '14 days'
    RETURNING id, company_id, target_employee_id
  LOOP
    IF r.target_employee_id IS NOT NULL THEN
      INSERT INTO new_starter_announcement_audit (
        company_id, announcement_id, employee_id, action
      ) VALUES (
        r.company_id, r.id, r.target_employee_id, 'deleted'
      );
    END IF;
  END LOOP;
END;
$$;

-- Schedule the cron job (daily at 07:00 UTC)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('process-new-starter-announcements');
    PERFORM cron.schedule(
      'process-new-starter-announcements',
      '0 7 * * *',
      'SELECT process_new_starter_announcements()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available, skipping cron schedule';
END;
$cron$;

-- ============================================================
-- 1f. Identity provider & licence skip columns
-- ============================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS identity_provider TEXT NOT NULL DEFAULT 'entra';

DO $$
BEGIN
  ALTER TABLE companies
    ADD CONSTRAINT chk_identity_provider
    CHECK (identity_provider IN ('entra', 'google_workspace'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END;
$$;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS skip_licence_assignment BOOLEAN DEFAULT false;

-- ============================================================
-- 1g. Permissions
-- ============================================================

REVOKE EXECUTE ON FUNCTION process_new_starter_announcements() FROM anon;
GRANT EXECUTE ON FUNCTION process_new_starter_announcements() TO authenticated;
