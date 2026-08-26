-- ============================================================================
-- INFLOWHR VOLUME TEST DELETE
-- Removes ALL data seeded by volume_seed.sql for Company ID:
--   99999999-9999-9999-9999-999999999999
--
-- Run in the Supabase SQL Editor (service_role / postgres).
-- Delete order respects FK constraints (children first, parents last).
-- ============================================================================

DO $$
DECLARE
  v_co uuid := '99999999-9999-9999-9999-999999999999';
  v_emp_count int;
BEGIN
  -- Count employees before deletion for confirmation
  SELECT count(*) INTO v_emp_count FROM employees WHERE company_id = v_co;
  RAISE NOTICE 'Deleting Volume Test Corp data — % employees found', v_emp_count;

  -- ══════════════════════════════════════════════════════════
  -- TRANSACTION DATA (children → parents)
  -- ══════════════════════════════════════════════════════════

  -- Performance
  DELETE FROM performance_goal_comments WHERE company_id = v_co;
  DELETE FROM performance_goals         WHERE company_id = v_co;
  DELETE FROM performance_reviews       WHERE company_id = v_co;

  -- One-to-one meetings
  DELETE FROM one_to_one_comments       WHERE company_id = v_co;
  DELETE FROM one_to_one_meetings       WHERE company_id = v_co;

  -- Leave
  DELETE FROM leave_requests            WHERE company_id = v_co;
  DELETE FROM leave_balances            WHERE company_id = v_co;
  DELETE FROM leave_types               WHERE company_id = v_co;

  -- Expenses
  DELETE FROM expense_line_items        WHERE company_id = v_co;
  DELETE FROM expense_claims            WHERE company_id = v_co;

  -- Payslips
  DELETE FROM payslips                  WHERE company_id = v_co;

  -- Kudos
  DELETE FROM kudos                     WHERE company_id = v_co;

  -- Timesheets
  DELETE FROM timesheets                WHERE company_id = v_co;

  -- Space management
  DELETE FROM space_bookings            WHERE company_id = v_co;
  DELETE FROM space_settings            WHERE company_id = v_co;
  DELETE FROM spaces                    WHERE company_id = v_co;
  DELETE FROM floors                    WHERE company_id = v_co;
  DELETE FROM locations                 WHERE company_id = v_co;

  -- Shift management
  DELETE FROM shift_assignments         WHERE company_id = v_co;
  DELETE FROM rotas                     WHERE company_id = v_co;
  DELETE FROM shift_templates           WHERE company_id = v_co;

  -- HR tickets
  DELETE FROM hr_tickets                WHERE company_id = v_co;

  -- Workflow
  DELETE FROM workflow_tracker          WHERE company_id = v_co;

  -- Notifications & announcements
  DELETE FROM notifications             WHERE company_id = v_co;
  DELETE FROM announcements             WHERE company_id = v_co;

  -- Onboarding
  DELETE FROM onboarding                WHERE company_id = v_co;

  -- ══════════════════════════════════════════════════════════
  -- CONFIG DATA
  -- ══════════════════════════════════════════════════════════
  DELETE FROM app_settings              WHERE company_id = v_co;
  DELETE FROM company_features          WHERE company_id = v_co;

  -- Benefits (old schema — employee_benefits uses employee FK not company)
  DELETE FROM employee_benefits         WHERE employee_id IN (SELECT id FROM employees WHERE company_id = v_co);
  -- Benefits (new schema)
  DELETE FROM benefit_enrollments       WHERE company_id = v_co;
  DELETE FROM benefit_options           WHERE company_id = v_co;
  DELETE FROM benefit_types             WHERE company_id = v_co;

  -- User settings
  DELETE FROM user_settings             WHERE employee_id IN (SELECT id FROM employees WHERE company_id = v_co);

  -- ══════════════════════════════════════════════════════════
  -- MASTER DATA
  -- ══════════════════════════════════════════════════════════
  DELETE FROM company_users             WHERE company_id = v_co;
  DELETE FROM employees                 WHERE company_id = v_co;
  DELETE FROM companies                 WHERE id = v_co;

  RAISE NOTICE '══════════════════════════════════════════════';
  RAISE NOTICE 'VOLUME TEST DATA DELETED';
  RAISE NOTICE 'Removed % employees and all associated data', v_emp_count;
  RAISE NOTICE 'Company ID: %', v_co;
  RAISE NOTICE '══════════════════════════════════════════════';
END $$;
