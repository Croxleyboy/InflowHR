-- ============================================================
-- Drop stale "Tenant isolation" FOR ALL policies from migration 001
-- These are superseded by the per-operation policies in migration 020
-- (Company scoped read/insert/update/delete) which include super admin access.
--
-- The FOR ALL policies use get_my_company_id() which returns LIMIT 1,
-- breaking INSERT for users with multiple company_users rows (the
-- returned company_id may not match the row being inserted).
-- The per-operation policies from 020 already cover all CRUD correctly.
-- ============================================================

DROP POLICY IF EXISTS "Tenant isolation" ON employees;
DROP POLICY IF EXISTS "Tenant isolation" ON expense_claims;
DROP POLICY IF EXISTS "Tenant isolation" ON expense_line_items;
DROP POLICY IF EXISTS "Tenant isolation" ON leave_requests;
DROP POLICY IF EXISTS "Tenant isolation" ON leave_balances;
DROP POLICY IF EXISTS "Tenant isolation" ON leave_types;
DROP POLICY IF EXISTS "Tenant isolation" ON onboarding;
DROP POLICY IF EXISTS "Tenant isolation" ON kudos;
DROP POLICY IF EXISTS "Tenant isolation" ON announcements;
DROP POLICY IF EXISTS "Tenant isolation" ON payslips;
DROP POLICY IF EXISTS "Tenant isolation" ON workflow_tracker;
DROP POLICY IF EXISTS "Tenant isolation" ON notifications;
DROP POLICY IF EXISTS "Tenant isolation" ON app_settings;
