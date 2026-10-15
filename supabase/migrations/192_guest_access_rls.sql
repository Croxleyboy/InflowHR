-- Migration 192: Fix RLS policies for guest user cross-company access
-- Updates can_access_company() and key SELECT policies so guests can read
-- data belonging to the company they are guesting into.

-- 1. Update can_access_company() to include guest_users check
-- This fixes SELECT on: employees, expenses, leave_requests, timesheets,
-- payslips, benefit_types, announcements, notifications, rotas, shifts, etc.
CREATE OR REPLACE FUNCTION public.can_access_company(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN is_super_admin() THEN has_active_support_access(p_company_id)
      ELSE (
        is_my_company(p_company_id)
        OR EXISTS (
          SELECT 1 FROM guest_users
          WHERE guest_users.auth_user_id = auth.uid()
            AND guest_users.company_id = p_company_id
            AND guest_users.is_active = true
        )
      )
    END;
$function$;

-- 2. Fix companies SELECT policy — guests need to load the guest company
DROP POLICY IF EXISTS "Company scoped read" ON companies;
CREATE POLICY "Company scoped read" ON companies FOR SELECT TO authenticated
  USING (
    is_my_company(id)
    OR is_super_admin()
    OR EXISTS (
      SELECT 1 FROM guest_users
      WHERE guest_users.auth_user_id = auth.uid()
        AND guest_users.company_id = companies.id
        AND guest_users.is_active = true
    )
  );

-- 3. Fix benefits SELECT — uses get_my_company_id() directly
DROP POLICY IF EXISTS "Company scoped read" ON benefits;
CREATE POLICY "Company scoped read" ON benefits FOR SELECT TO authenticated
  USING (
    company_id = get_my_company_id()
    OR company_id IS NULL
    OR is_super_admin()
    OR EXISTS (
      SELECT 1 FROM guest_users
      WHERE guest_users.auth_user_id = auth.uid()
        AND guest_users.company_id = benefits.company_id
        AND guest_users.is_active = true
    )
  );

-- 4. Fix expense_cost_centers SELECT — uses company_users subquery directly
DROP POLICY IF EXISTS expense_cost_centers_select ON expense_cost_centers;
CREATE POLICY expense_cost_centers_select ON expense_cost_centers FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT company_users.company_id FROM company_users
      WHERE company_users.auth_user_id = auth.uid() AND company_users.is_active = true
    )
    OR is_super_admin()
    OR EXISTS (
      SELECT 1 FROM guest_users
      WHERE guest_users.auth_user_id = auth.uid()
        AND guest_users.company_id = expense_cost_centers.company_id
        AND guest_users.is_active = true
    )
  );

-- 5. Fix expense_expense_types SELECT — uses company_users subquery directly
DROP POLICY IF EXISTS expense_expense_types_select ON expense_expense_types;
CREATE POLICY expense_expense_types_select ON expense_expense_types FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT company_users.company_id FROM company_users
      WHERE company_users.auth_user_id = auth.uid() AND company_users.is_active = true
    )
    OR is_super_admin()
    OR EXISTS (
      SELECT 1 FROM guest_users
      WHERE guest_users.auth_user_id = auth.uid()
        AND guest_users.company_id = expense_expense_types.company_id
        AND guest_users.is_active = true
    )
  );

-- 6. Fix pay_period_reviews SELECT — uses get_my_company_id() directly
DROP POLICY IF EXISTS ppr_select ON pay_period_reviews;
CREATE POLICY ppr_select ON pay_period_reviews FOR SELECT TO authenticated
  USING (
    company_id = get_my_company_id()
    OR is_super_admin()
    OR EXISTS (
      SELECT 1 FROM guest_users
      WHERE guest_users.auth_user_id = auth.uid()
        AND guest_users.company_id = pay_period_reviews.company_id
        AND guest_users.is_active = true
    )
  );

-- 7. Fix payroll_audit_log SELECT — uses get_my_company_id() directly
DROP POLICY IF EXISTS pal_select ON payroll_audit_log;
CREATE POLICY pal_select ON payroll_audit_log FOR SELECT TO authenticated
  USING (
    company_id = get_my_company_id()
    OR is_super_admin()
    OR EXISTS (
      SELECT 1 FROM guest_users
      WHERE guest_users.auth_user_id = auth.uid()
        AND guest_users.company_id = payroll_audit_log.company_id
        AND guest_users.is_active = true
    )
  );

-- 8. Fix payroll_exports SELECT — uses get_my_company_id() directly
DROP POLICY IF EXISTS pe_select ON payroll_exports;
CREATE POLICY pe_select ON payroll_exports FOR SELECT TO authenticated
  USING (
    company_id = get_my_company_id()
    OR is_super_admin()
    OR EXISTS (
      SELECT 1 FROM guest_users
      WHERE guest_users.auth_user_id = auth.uid()
        AND guest_users.company_id = payroll_exports.company_id
        AND guest_users.is_active = true
    )
  );

-- 9. Fix company_features SELECT — guests need to load features for their company
-- Already uses can_access_company so covered by #1, but double-checking it exists
-- (No change needed — can_access_company fix covers it)

-- 10. Fix app_settings SELECT — already has can_access_company policy so covered by #1
-- (No change needed)
