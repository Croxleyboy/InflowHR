-- Migration 246: Fix enable_pack and cancel_pack RPCs
-- The subscription_pricing table uses default_price, not per_user_price.
-- Both RPCs referenced the non-existent column "per_user_price", causing them to fail.

-- ── Fix enable_pack ─────────────────────────────────────────────────────────
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

  -- Determine pack child features
  IF p_pack_key = 'pack_a' THEN
    v_feature_keys := ARRAY['shifts', 'legal_timesheets', 'space_booking', 'asset_management'];
    v_display_name := 'People Operations';
  ELSIF p_pack_key = 'pack_b' THEN
    v_feature_keys := ARRAY['teams_integration', 'skills_passport', 'modulr_integration', 'ai_help_agent'];
    v_display_name := 'Pro Integrations';
  ELSE
    RAISE EXCEPTION 'Invalid pack key: %', p_pack_key;
  END IF;

  -- Check if company is fixed billing or trial (exempt from pro-rata)
  SELECT
    COALESCE(c.billing_type = 'fixed', false),
    COALESCE(c.is_trial, false)
  INTO v_is_fixed, v_is_trial
  FROM companies c WHERE c.id = p_company_id;

  -- Get current employee count
  SELECT COUNT(*) INTO v_employee_count
  FROM employees WHERE company_id = p_company_id AND is_active = true;

  -- Get pack price (custom or default)
  SELECT COALESCE(cf.custom_price, sp.default_price)
  INTO v_price
  FROM subscription_pricing sp
  LEFT JOIN company_features cf ON cf.company_id = p_company_id AND cf.feature_key = p_pack_key
  WHERE sp.feature_key = p_pack_key;

  IF v_price IS NULL THEN v_price := 0; END IF;

  -- Upsert the pack feature row
  INSERT INTO company_features (company_id, feature_key, is_enabled, activated_at, grace_period_ends_at, cancellation_scheduled, cancellation_effective_date, deactivated_at)
  VALUES (p_company_id, p_pack_key, true, v_now, v_now + INTERVAL '7 days', false, NULL, NULL)
  ON CONFLICT (company_id, feature_key) DO UPDATE SET
    is_enabled = true,
    activated_at = v_now,
    grace_period_ends_at = v_now + INTERVAL '7 days',
    cancellation_scheduled = false,
    cancellation_effective_date = NULL,
    deactivated_at = NULL;

  -- Upsert child feature rows
  FOREACH v_fk IN ARRAY v_feature_keys LOOP
    INSERT INTO company_features (company_id, feature_key, is_enabled, activated_at, grace_period_ends_at)
    VALUES (p_company_id, v_fk, true, v_now, v_now + INTERVAL '7 days')
    ON CONFLICT (company_id, feature_key) DO UPDATE SET
      is_enabled = true,
      activated_at = v_now,
      grace_period_ends_at = v_now + INTERVAL '7 days',
      cancellation_scheduled = false,
      cancellation_effective_date = NULL,
      deactivated_at = NULL;
  END LOOP;

  -- Calculate pro-rata (skip for fixed/trial)
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

    -- Update billing snapshot adjustments_total
    UPDATE billing_snapshots
    SET adjustments_total = adjustments_total + v_pro_rata_amount,
        updated_at = now()
    WHERE company_id = p_company_id
      AND year = EXTRACT(YEAR FROM v_today)::INT
      AND month = EXTRACT(MONTH FROM v_today)::INT
      AND is_locked = false;
  END IF;

  -- Log the change
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


-- ── Fix cancel_pack ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_pack(p_company_id UUID, p_pack_key TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feature_keys TEXT[];
  v_display_name TEXT;
  v_fk TEXT;
  v_grace_ends TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_today DATE := CURRENT_DATE;
  v_end_of_month DATE;
  v_within_grace BOOLEAN;
  v_pro_rata_charge NUMERIC(10,2);
  v_price NUMERIC(10,2);
  v_employee_count INT;
BEGIN
  IF NOT is_super_admin() AND NOT (is_company_admin() AND is_my_company(p_company_id)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_pack_key = 'pack_a' THEN
    v_feature_keys := ARRAY['shifts', 'legal_timesheets', 'space_booking', 'asset_management'];
    v_display_name := 'People Operations';
  ELSIF p_pack_key = 'pack_b' THEN
    v_feature_keys := ARRAY['teams_integration', 'skills_passport', 'modulr_integration', 'ai_help_agent'];
    v_display_name := 'Pro Integrations';
  ELSE
    RAISE EXCEPTION 'Invalid pack key: %', p_pack_key;
  END IF;

  -- Get the grace period end
  SELECT cf.grace_period_ends_at INTO v_grace_ends
  FROM company_features cf
  WHERE cf.company_id = p_company_id AND cf.feature_key = p_pack_key AND cf.is_enabled = true;

  IF v_grace_ends IS NULL THEN
    RAISE EXCEPTION 'Pack % is not currently enabled for this company', p_pack_key;
  END IF;

  v_within_grace := v_grace_ends > v_now;
  v_end_of_month := (date_trunc('month', v_today) + INTERVAL '1 month - 1 day')::DATE;

  IF v_within_grace THEN
    -- Grace period: disable immediately, reverse the charge
    UPDATE company_features
    SET is_enabled = false, deactivated_at = v_now, cancellation_scheduled = false, cancellation_effective_date = NULL
    WHERE company_id = p_company_id AND feature_key = p_pack_key;

    FOREACH v_fk IN ARRAY v_feature_keys LOOP
      UPDATE company_features
      SET is_enabled = false, deactivated_at = v_now
      WHERE company_id = p_company_id AND feature_key = v_fk;
    END LOOP;

    -- Find and reverse the pro-rata charge
    SELECT ba.line_amount INTO v_pro_rata_charge
    FROM billing_adjustments ba
    WHERE ba.company_id = p_company_id
      AND ba.feature_key = p_pack_key
      AND ba.adjustment_type = 'pro_rata_charge'
      AND ba.year = EXTRACT(YEAR FROM v_today)::INT
      AND ba.month = EXTRACT(MONTH FROM v_today)::INT
    ORDER BY ba.created_at DESC LIMIT 1;

    IF v_pro_rata_charge IS NOT NULL AND v_pro_rata_charge > 0 THEN
      SELECT COALESCE(cf.custom_price, sp.default_price), COUNT(e.id)
      INTO v_price, v_employee_count
      FROM subscription_pricing sp
      LEFT JOIN company_features cf ON cf.company_id = p_company_id AND cf.feature_key = p_pack_key
      LEFT JOIN employees e ON e.company_id = p_company_id AND e.is_active = true
      WHERE sp.feature_key = p_pack_key
      GROUP BY cf.custom_price, sp.default_price;

      INSERT INTO billing_adjustments (
        company_id, year, month, feature_key, display_name,
        adjustment_type, days_charged, days_in_month,
        price_per_user, employee_count, line_amount
      ) VALUES (
        p_company_id, EXTRACT(YEAR FROM v_today)::INT, EXTRACT(MONTH FROM v_today)::INT,
        p_pack_key, v_display_name, 'grace_reversal', 0, 0,
        COALESCE(v_price, 0), COALESCE(v_employee_count, 0), -v_pro_rata_charge
      );

      -- Update snapshot
      UPDATE billing_snapshots
      SET adjustments_total = adjustments_total - v_pro_rata_charge, updated_at = now()
      WHERE company_id = p_company_id
        AND year = EXTRACT(YEAR FROM v_today)::INT
        AND month = EXTRACT(MONTH FROM v_today)::INT
        AND is_locked = false;
    END IF;

    INSERT INTO feature_change_log (company_id, feature_key, action, changed_by, notes)
    VALUES (p_company_id, p_pack_key, 'grace_cancelled', auth.uid(),
      'Cancelled within grace period — no charge');

    RETURN jsonb_build_object(
      'success', true,
      'cancel_type', 'grace_immediate',
      'pack', p_pack_key,
      'display_name', v_display_name,
      'reversed_amount', COALESCE(v_pro_rata_charge, 0)
    );

  ELSE
    -- Past grace: schedule end-of-month cancellation
    UPDATE company_features
    SET cancellation_scheduled = true, cancellation_effective_date = v_end_of_month
    WHERE company_id = p_company_id AND feature_key = p_pack_key;

    FOREACH v_fk IN ARRAY v_feature_keys LOOP
      UPDATE company_features
      SET cancellation_scheduled = true, cancellation_effective_date = v_end_of_month
      WHERE company_id = p_company_id AND feature_key = v_fk;
    END LOOP;

    INSERT INTO feature_change_log (company_id, feature_key, action, changed_by, notes)
    VALUES (p_company_id, p_pack_key, 'scheduled_cancel', auth.uid(),
      'Scheduled cancellation effective ' || v_end_of_month::TEXT);

    RETURN jsonb_build_object(
      'success', true,
      'cancel_type', 'scheduled',
      'pack', p_pack_key,
      'display_name', v_display_name,
      'effective_date', v_end_of_month::TEXT
    );
  END IF;
END;
$$;
