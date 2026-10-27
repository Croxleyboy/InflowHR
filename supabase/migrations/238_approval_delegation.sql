-- 238: Temporary Approval Delegation
-- Allows managers/admins to delegate their approval responsibilities
-- to a team member for a selected date range (e.g. holiday cover).
-- Rollback: DROP TABLE approval_delegations;


-- ============================================================
-- 1. Delegation table
-- ============================================================

CREATE TABLE IF NOT EXISTS approval_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  delegator_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  delegate_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  reason TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT chk_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_not_self CHECK (delegator_id <> delegate_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_delegations_company
  ON approval_delegations(company_id);

CREATE INDEX IF NOT EXISTS idx_approval_delegations_delegate
  ON approval_delegations(delegate_id, start_date, end_date)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_approval_delegations_delegator
  ON approval_delegations(delegator_id)
  WHERE is_active = true;

COMMENT ON COLUMN approval_delegations.scope IS 'all = leave+expenses+timesheets, or comma-separated: leave,expenses,timesheets';


-- ============================================================
-- 2. RLS policies
-- ============================================================

ALTER TABLE approval_delegations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "approval_delegations_read" ON approval_delegations
  FOR SELECT USING (
    company_id = get_my_company_id()
    OR is_super_admin()
  );

CREATE POLICY "approval_delegations_write" ON approval_delegations
  FOR ALL USING (
    company_id = get_my_company_id()
    OR is_super_admin()
  );


-- ============================================================
-- 3. RPC: get active delegations for current user (as delegate)
--    Returns delegator employee IDs this user is currently covering
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_active_delegations()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ad.delegator_id
  FROM approval_delegations ad
  JOIN employees e ON e.id = ad.delegate_id
  WHERE e.auth_user_id = auth.uid()
    AND ad.is_active = true
    AND CURRENT_DATE BETWEEN ad.start_date AND ad.end_date;
$$;


-- ============================================================
-- 4. RPC: get delegations I have created (as delegator)
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_delegations_out()
RETURNS TABLE(
  id UUID,
  delegate_id UUID,
  delegate_name TEXT,
  start_date DATE,
  end_date DATE,
  scope TEXT,
  reason TEXT,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ad.id,
    ad.delegate_id,
    e.first_name || ' ' || e.last_name,
    ad.start_date,
    ad.end_date,
    ad.scope,
    ad.reason,
    ad.is_active
  FROM approval_delegations ad
  JOIN employees e ON e.id = ad.delegate_id
  JOIN employees me ON me.id = ad.delegator_id
  WHERE me.auth_user_id = auth.uid()
  ORDER BY ad.start_date DESC;
$$;


-- ============================================================
-- 5. RPC: get delegations assigned to me (as delegate)
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_delegations_in()
RETURNS TABLE(
  id UUID,
  delegator_id UUID,
  delegator_name TEXT,
  start_date DATE,
  end_date DATE,
  scope TEXT,
  reason TEXT,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ad.id,
    ad.delegator_id,
    e.first_name || ' ' || e.last_name,
    ad.start_date,
    ad.end_date,
    ad.scope,
    ad.reason,
    ad.is_active
  FROM approval_delegations ad
  JOIN employees e ON e.id = ad.delegator_id
  JOIN employees me ON me.id = ad.delegate_id
  WHERE me.auth_user_id = auth.uid()
  ORDER BY ad.start_date DESC;
$$;


-- ============================================================
-- 6. Update delete_company_data to include new table
-- ============================================================

-- (approval_delegations CASCADE deletes via company_id FK)


-- ============================================================
-- 7. Permissions
-- ============================================================

REVOKE EXECUTE ON FUNCTION get_my_active_delegations() FROM anon;
GRANT EXECUTE ON FUNCTION get_my_active_delegations() TO authenticated;

REVOKE EXECUTE ON FUNCTION get_my_delegations_out() FROM anon;
GRANT EXECUTE ON FUNCTION get_my_delegations_out() TO authenticated;

REVOKE EXECUTE ON FUNCTION get_my_delegations_in() FROM anon;
GRANT EXECUTE ON FUNCTION get_my_delegations_in() TO authenticated;
