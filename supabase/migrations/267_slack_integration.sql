-- Migration 267: Slack Integration
-- Adds slack_integrations table, subscription_pricing row, and updates enable_pack for pack_b

-- 1. Create slack_integrations table
CREATE TABLE IF NOT EXISTS slack_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  webhook_url TEXT,
  bot_token_encrypted TEXT,
  default_channel TEXT,
  notify_leave_requests BOOLEAN NOT NULL DEFAULT true,
  notify_expense_claims BOOLEAN NOT NULL DEFAULT true,
  notify_shift_changes BOOLEAN NOT NULL DEFAULT true,
  notify_onboarding BOOLEAN NOT NULL DEFAULT true,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id)
);

ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company scoped read" ON slack_integrations
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Admin insert" ON slack_integrations
  FOR INSERT WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Admin update" ON slack_integrations
  FOR UPDATE USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Admin delete" ON slack_integrations
  FOR DELETE USING (company_id = get_my_company_id() OR is_super_admin());

-- 2. Add subscription pricing row for slack_integration
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active, pack)
VALUES ('slack_integration', 'Slack Notifications', 'Post HR notifications to Slack channels', 0, true, true, 'pack_b')
ON CONFLICT (feature_key) DO NOTHING;

-- 3. Update enable_pack to include slack_integration in pack_b
CREATE OR REPLACE FUNCTION enable_pack(p_company_id UUID, p_pack_key TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feature_keys TEXT[];
  v_display_name TEXT;
  v_fk TEXT;
  v_price NUMERIC(10,2);
  v_custom_price NUMERIC(10,2);
  v_employee_count INT;
  v_days_remaining INT;
  v_days_in_month INT;
  v_pro_rata_amount NUMERIC(10,2);
  v_now TIMESTAMPTZ := now();
  v_today DATE := CURRENT_DATE;
  v_is_fixed BOOLEAN;
  v_is_trial BOOLEAN;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  IF p_pack_key = 'pack_a' THEN
    v_feature_keys := ARRAY['shifts', 'legal_timesheets', 'space_booking', 'asset_management'];
    v_display_name := 'People Operations';
  ELSIF p_pack_key = 'pack_b' THEN
    v_feature_keys := ARRAY['teams_integration', 'skills_passport', 'modulr_integration', 'ai_help_agent', 'slack_integration'];
    v_display_name := 'Pro Integrations';
  ELSE
    RAISE EXCEPTION 'Invalid pack key: %', p_pack_key;
  END IF;

  SELECT
    COALESCE(c.billing_type = 'fixed', false),
    COALESCE(c.is_trial, false)
  INTO v_is_fixed, v_is_trial
  FROM companies c WHERE c.id = p_company_id;

  SELECT COUNT(*) INTO v_employee_count
  FROM employees WHERE company_id = p_company_id AND is_active = true;

  SELECT COALESCE(cf.custom_price, sp.default_price)
  INTO v_price
  FROM subscription_pricing sp
  LEFT JOIN company_features cf ON cf.company_id = p_company_id AND cf.feature_key = p_pack_key
  WHERE sp.feature_key = p_pack_key;

  IF v_price IS NULL THEN v_price := 0; END IF;

  INSERT INTO company_features (company_id, feature_key, is_enabled, is_visible, activated_at, grace_period_ends_at, cancellation_scheduled, cancellation_effective_date, deactivated_at)
  VALUES (p_company_id, p_pack_key, true, true, v_now, v_now + INTERVAL '7 days', false, NULL, NULL)
  ON CONFLICT (company_id, feature_key) DO UPDATE SET
    is_enabled = true,
    is_visible = true,
    activated_at = v_now,
    grace_period_ends_at = v_now + INTERVAL '7 days',
    cancellation_scheduled = false,
    cancellation_effective_date = NULL,
    deactivated_at = NULL;

  FOREACH v_fk IN ARRAY v_feature_keys LOOP
    INSERT INTO company_features (company_id, feature_key, is_enabled, is_visible, activated_at, grace_period_ends_at)
    VALUES (p_company_id, v_fk, true, true, v_now, v_now + INTERVAL '7 days')
    ON CONFLICT (company_id, feature_key) DO UPDATE SET
      is_enabled = true,
      is_visible = true,
      activated_at = v_now,
      grace_period_ends_at = v_now + INTERVAL '7 days',
      cancellation_scheduled = false,
      cancellation_effective_date = NULL,
      deactivated_at = NULL;
  END LOOP;

  v_pro_rata_amount := 0;
  IF NOT v_is_fixed AND NOT v_is_trial AND v_price > 0 THEN
    v_days_in_month := EXTRACT(DAY FROM (date_trunc('month', v_today) + INTERVAL '1 month - 1 day'))::INT;
    v_days_remaining := v_days_in_month - EXTRACT(DAY FROM v_today)::INT + 1;
    v_pro_rata_amount := ROUND((v_days_remaining::NUMERIC / v_days_in_month::NUMERIC) * v_price * v_employee_count, 2);

    INSERT INTO billing_adjustments (
      company_id, year, month, feature_key, display_name,
      adjustment_type, activation_date, days_charged, days_in_month,
      price_per_user, employee_count, line_amount
    ) VALUES (
      p_company_id, EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM v_today)::INT,
      p_pack_key, v_display_name, 'pro_rata_charge', v_today,
      v_days_remaining, v_days_in_month, v_price, v_employee_count, v_pro_rata_amount
    );

    UPDATE billing_snapshots
    SET adjustments_total = adjustments_total + v_pro_rata_amount,
        updated_at = now()
    WHERE company_id = p_company_id
      AND year = EXTRACT(YEAR FROM v_today)::INT
      AND month = EXTRACT(MONTH FROM v_today)::INT
      AND is_locked = false;
  END IF;

  INSERT INTO feature_change_log (company_id, feature_key, action, changed_by, effective_price, employee_count, notes)
  VALUES (p_company_id, p_pack_key, 'enabled', auth.uid(), v_price, v_employee_count,
    CASE WHEN v_is_fixed OR v_is_trial THEN 'No pro-rata (exempt)'
         ELSE 'Pro-rata: £' || v_pro_rata_amount::TEXT END);

  RETURN jsonb_build_object(
    'success', true,
    'pack', p_pack_key,
    'display_name', v_display_name,
    'pro_rata_amount', v_pro_rata_amount,
    'days_remaining', v_days_remaining,
    'days_in_month', v_days_in_month,
    'grace_period_ends_at', (v_now + INTERVAL '7 days')::TEXT,
    'exempt', v_is_fixed OR v_is_trial
  );
END;
$$;
