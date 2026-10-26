-- 235: Notify super admin when a company admin cancels a pack
-- Adds an HR ticket (same pattern as whole-service cancellation in 095_cancellation.sql)

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
  v_company_name TEXT;
  v_next_ref TEXT;
  v_is_company_admin BOOLEAN;
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

  -- Check if the caller is a company admin (not super admin) for ticket creation
  v_is_company_admin := is_company_admin() AND NOT is_super_admin();

  -- Get company name for ticket
  IF v_is_company_admin THEN
    SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;
  END IF;

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
      -- Get display info for the reversal
      SELECT COALESCE(cf.custom_price, sp.per_user_price), COUNT(e.id)
      INTO v_price, v_employee_count
      FROM subscription_pricing sp
      LEFT JOIN company_features cf ON cf.company_id = p_company_id AND cf.feature_key = p_pack_key
      LEFT JOIN employees e ON e.company_id = p_company_id AND e.status = 'active'
      WHERE sp.feature_key = p_pack_key
      GROUP BY cf.custom_price, sp.per_user_price;

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

    -- Notify super admin via HR ticket (company admin cancellations only)
    IF v_is_company_admin THEN
      SELECT 'HR-' || LPAD((COALESCE(MAX(CAST(SUBSTRING(ref FROM 4) AS int)), 0) + 1)::text, 3, '0')
        INTO v_next_ref
        FROM hr_tickets;

      INSERT INTO hr_tickets (
        ref, title, description, category, priority, status,
        submitted_by, company_id
      ) VALUES (
        v_next_ref,
        'PACK CANCELLATION — ' || v_company_name || ' — ' || v_display_name || ' (Grace Period)',
        'Company "' || v_company_name || '" has cancelled the ' || v_display_name || ' pack within the 7-day grace period.' ||
        E'\n\nPack disabled immediately with no charge.' ||
        E'\n\nReversed amount: £' || COALESCE(v_pro_rata_charge, 0)::text ||
        E'\n\nData from this pack (e.g. shifts, bookings, assets) has been retained but is hidden from the company.',
        'cancellation',
        'medium',
        'open',
        auth.uid()::text,
        p_company_id
      );
    END IF;

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

    -- Notify super admin via HR ticket (company admin cancellations only)
    IF v_is_company_admin THEN
      SELECT 'HR-' || LPAD((COALESCE(MAX(CAST(SUBSTRING(ref FROM 4) AS int)), 0) + 1)::text, 3, '0')
        INTO v_next_ref
        FROM hr_tickets;

      INSERT INTO hr_tickets (
        ref, title, description, category, priority, status,
        submitted_by, company_id
      ) VALUES (
        v_next_ref,
        'PACK CANCELLATION — ' || v_company_name || ' — ' || v_display_name,
        'Company "' || v_company_name || '" has requested cancellation of the ' || v_display_name || ' pack.' ||
        E'\n\nPack remains active until: ' || v_end_of_month::text ||
        E'\n\nThe company will not be charged for this pack from next month.' ||
        E'\n\nData from this pack (e.g. shifts, bookings, assets) will be retained but hidden after cancellation takes effect.',
        'cancellation',
        'medium',
        'open',
        auth.uid()::text,
        p_company_id
      );
    END IF;

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
