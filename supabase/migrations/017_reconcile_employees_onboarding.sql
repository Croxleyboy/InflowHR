-- =====================================================
-- Reconciliation: sync employees ↔ onboarding tables
-- Run AFTER 016_onboarding_avatar.sql
-- =====================================================

-- 1. Remove duplicate onboarding records (keep lowest id per email)
DELETE FROM onboarding WHERE id IN (
  SELECT o.id FROM onboarding o
  INNER JOIN (SELECT user_email, MIN(id) AS keep_id FROM onboarding GROUP BY user_email HAVING COUNT(*) > 1) d
  ON o.user_email = d.user_email AND o.id != d.keep_id
);

-- 2. Fix status/appstatus: only records with is_complete=true should be Onboarded/active
--    Reset records that were wrongly marked Onboarded by previous reconciliation
UPDATE onboarding
SET status = 'in-progress', appstatus = 'inactive'
WHERE is_complete = false
AND equipment_order = 'N' AND first_day = false AND first_week = false AND elearning = false
AND (skipped_steps IS NULL OR skipped_steps = '{}'::jsonb);

-- 3. Records with some workflow progress but not complete → in-progress / inactive
UPDATE onboarding
SET status = 'in-progress', appstatus = 'inactive'
WHERE is_complete = false
AND (equipment_order = 'Y' OR first_day = true OR first_week = true OR elearning = true
     OR (skipped_steps IS NOT NULL AND skipped_steps != '{}'::jsonb));

-- 4. Genuinely completed records stay Onboarded/active
UPDATE onboarding
SET status = 'Onboarded', appstatus = 'active'
WHERE is_complete = true;

-- 5. Sync employee is_active to match onboarding completion
--    Employees whose onboarding is not complete → inactive
UPDATE employees e
SET is_active = false
FROM onboarding o
WHERE o.user_email = e.email AND o.is_complete = false;

-- Employees whose onboarding IS complete → active
UPDATE employees e
SET is_active = true
FROM onboarding o
WHERE o.user_email = e.email AND o.is_complete = true;

-- 6. Sync avatars both directions
UPDATE onboarding o SET avatar_url = e.avatar_url
FROM employees e
WHERE e.email = o.user_email AND e.avatar_url IS NOT NULL
AND (o.avatar_url IS NULL OR o.avatar_url = '');

UPDATE employees e SET avatar_url = o.avatar_url
FROM onboarding o
WHERE o.user_email = e.email AND o.avatar_url IS NOT NULL
AND (e.avatar_url IS NULL OR e.avatar_url = '');

-- 7. Sync job titles and departments from employees → onboarding
UPDATE onboarding o
SET job_title = COALESCE(e.job_title, o.job_title),
    department = COALESCE(e.department, o.department),
    telephone = COALESCE(e.phone, o.telephone)
FROM employees e
WHERE e.email = o.user_email;
