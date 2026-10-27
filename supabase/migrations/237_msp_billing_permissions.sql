-- 237: MSP Billing & Permission Scoping (Phase 3)
-- Adds wholesale billing summary RPC, auto-tier calculation, and onboarded_at tracking.
-- Rollback: DROP the new functions. No existing tables/functions modified.


-- ============================================================
-- 1. Add onboarded_at to msp_managed_companies (if not present)
-- ============================================================

ALTER TABLE msp_managed_companies ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ DEFAULT now();


-- ============================================================
-- 2. MSP Wholesale Billing Summary (super admin view)
--    Returns one row per MSP with tier, managed count, employee total,
--    and monthly wholesale amount.
-- ============================================================

CREATE OR REPLACE FUNCTION get_msp_billing_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'msp_name'), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'msp_company_id', c.id,
      'msp_name', c.name,
      'msp_tier', c.msp_tier,
      'msp_wholesale_discount', c.msp_wholesale_discount,
      'managed_count', (
        SELECT COUNT(*) FROM msp_managed_companies mc
        WHERE mc.msp_company_id = c.id AND mc.is_active = true
      ),
      'total_employees', (
        SELECT COALESCE(SUM(emp_ct), 0) FROM (
          SELECT COUNT(*) as emp_ct FROM employees e
          JOIN msp_managed_companies mc ON mc.managed_company_id = e.company_id
          WHERE mc.msp_company_id = c.id AND mc.is_active = true AND e.status = 'active'
        ) sub
      ),
      'monthly_wholesale', (
        SELECT COALESCE(SUM(
          CASE
            WHEN sp.per_user_price IS NOT NULL THEN
              sp.per_user_price * (1 - COALESCE(c.msp_wholesale_discount, 0) / 100.0) * emp_count.cnt
            ELSE 0
          END
        ), 0)
        FROM (
          SELECT cf.feature_key, cf.company_id
          FROM company_features cf
          JOIN msp_managed_companies mc ON mc.managed_company_id = cf.company_id
          WHERE mc.msp_company_id = c.id AND mc.is_active = true AND cf.is_enabled = true
        ) active_features
        LEFT JOIN subscription_pricing sp ON sp.feature_key = active_features.feature_key AND sp.is_active = true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) as cnt FROM employees e
          WHERE e.company_id = active_features.company_id AND e.status = 'active'
        ) emp_count ON true
      ),
      'managed_companies', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'company_id', co.id,
          'company_name', co.name,
          'is_active', co.is_active,
          'is_trial', co.is_trial,
          'employee_count', (SELECT COUNT(*) FROM employees e WHERE e.company_id = co.id AND e.status = 'active'),
          'onboarded_at', mc.onboarded_at,
          'monthly_cost', (
            SELECT COALESCE(SUM(
              CASE WHEN sp2.per_user_price IS NOT NULL THEN
                sp2.per_user_price * (1 - COALESCE(c.msp_wholesale_discount, 0) / 100.0) *
                (SELECT COUNT(*) FROM employees e2 WHERE e2.company_id = co.id AND e2.status = 'active')
              ELSE 0 END
            ), 0)
            FROM company_features cf2
            LEFT JOIN subscription_pricing sp2 ON sp2.feature_key = cf2.feature_key AND sp2.is_active = true
            WHERE cf2.company_id = co.id AND cf2.is_enabled = true
          )
        ) ORDER BY co.name)
        FROM msp_managed_companies mc
        JOIN companies co ON co.id = mc.managed_company_id
        WHERE mc.msp_company_id = c.id AND mc.is_active = true
      ), '[]'::jsonb)
    ) as row_data
    FROM companies c
    WHERE c.is_msp = true
  ) sub;

  RETURN v_result;
END;
$$;


-- ============================================================
-- 3. Auto-recalculate MSP tier based on total managed employees
--    Tiers: starter (1-100), growth (101-500), enterprise (501+)
-- ============================================================

CREATE OR REPLACE FUNCTION recalculate_msp_tiers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msp RECORD;
  v_total_employees INT;
  v_new_tier TEXT;
  v_new_discount NUMERIC(5,2);
  v_changes jsonb := '[]'::jsonb;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  FOR v_msp IN
    SELECT c.id, c.name, c.msp_tier, c.msp_wholesale_discount
    FROM companies c WHERE c.is_msp = true
  LOOP
    SELECT COUNT(*) INTO v_total_employees
    FROM employees e
    JOIN msp_managed_companies mc ON mc.managed_company_id = e.company_id
    WHERE mc.msp_company_id = v_msp.id AND mc.is_active = true AND e.status = 'active';

    IF v_total_employees >= 501 THEN
      v_new_tier := 'enterprise';
      v_new_discount := 40;
    ELSIF v_total_employees >= 101 THEN
      v_new_tier := 'growth';
      v_new_discount := 30;
    ELSE
      v_new_tier := 'starter';
      v_new_discount := 20;
    END IF;

    IF v_msp.msp_tier IS DISTINCT FROM v_new_tier OR v_msp.msp_wholesale_discount IS DISTINCT FROM v_new_discount THEN
      UPDATE companies
      SET msp_tier = v_new_tier, msp_wholesale_discount = v_new_discount
      WHERE id = v_msp.id;

      v_changes := v_changes || jsonb_build_object(
        'msp_id', v_msp.id,
        'msp_name', v_msp.name,
        'old_tier', v_msp.msp_tier,
        'new_tier', v_new_tier,
        'old_discount', v_msp.msp_wholesale_discount,
        'new_discount', v_new_discount,
        'total_employees', v_total_employees
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'changes', v_changes);
END;
$$;


-- ============================================================
-- 4. Log MSP action (callable from frontend for audit trail)
-- ============================================================

CREATE OR REPLACE FUNCTION log_msp_action(
  p_msp_company_id UUID,
  p_managed_company_id UUID,
  p_action TEXT,
  p_details JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is MSP user for this company or super admin
  IF NOT is_super_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM msp_user_access mua
      JOIN employees e ON e.id = mua.employee_id
      WHERE e.auth_user_id = auth.uid()
        AND mua.msp_company_id = p_msp_company_id
        AND mua.is_active = true
    ) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  INSERT INTO msp_audit_log (msp_company_id, managed_company_id, actor_id, action, details)
  VALUES (p_msp_company_id, p_managed_company_id, auth.uid(), p_action, p_details);
END;
$$;


-- ============================================================
-- 5. Get MSP permissions for current user on a specific company
-- ============================================================

CREATE OR REPLACE FUNCTION get_msp_permissions(p_managed_company_id UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(mua.permissions, '{}'::jsonb)
  FROM msp_user_access mua
  JOIN employees e ON e.id = mua.employee_id
  WHERE e.auth_user_id = auth.uid()
    AND mua.managed_company_id = p_managed_company_id
    AND mua.is_active = true
  LIMIT 1;
$$;


-- ============================================================
-- 6. Permissions
-- ============================================================

REVOKE EXECUTE ON FUNCTION get_msp_billing_summary() FROM anon;
GRANT EXECUTE ON FUNCTION get_msp_billing_summary() TO authenticated;

REVOKE EXECUTE ON FUNCTION recalculate_msp_tiers() FROM anon;
GRANT EXECUTE ON FUNCTION recalculate_msp_tiers() TO authenticated;

REVOKE EXECUTE ON FUNCTION log_msp_action(UUID, UUID, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION log_msp_action(UUID, UUID, TEXT, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_msp_permissions(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_msp_permissions(UUID) TO authenticated;
