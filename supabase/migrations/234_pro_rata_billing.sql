-- ============================================================
-- 234: Pro-rata billing, 7-day grace period, individual pack cancellation
-- ============================================================

-- 1a. Add activation/cancellation tracking to company_features
ALTER TABLE company_features
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_scheduled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancellation_effective_date DATE;

-- Backfill: existing enabled features get their created_at as activation date
UPDATE company_features
SET activated_at = created_at,
    grace_period_ends_at = created_at + INTERVAL '7 days'
WHERE is_enabled = true AND activated_at IS NULL;


-- 1b. Feature change log (immutable audit trail)
CREATE TABLE IF NOT EXISTS feature_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'enabled', 'disabled', 'grace_cancelled', 'scheduled_cancel', 'rollover_disabled'
  )),
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_price NUMERIC(10,2),
  employee_count INT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_feature_change_log_company
  ON feature_change_log(company_id, changed_at DESC);

ALTER TABLE feature_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feature_change_log_select"
  ON feature_change_log FOR SELECT
  USING (is_my_company(company_id) OR is_super_admin());

CREATE POLICY "feature_change_log_insert"
  ON feature_change_log FOR INSERT
  WITH CHECK (is_super_admin());


-- 1c. Billing adjustments (pro-rata charges and grace reversals)
CREATE TABLE IF NOT EXISTS billing_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  feature_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('pro_rata_charge', 'grace_reversal')),
  activation_date DATE,
  days_charged INT,
  days_in_month INT,
  price_per_user NUMERIC(10,2) NOT NULL DEFAULT 0,
  employee_count INT NOT NULL DEFAULT 0,
  line_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_adjustments_company
  ON billing_adjustments(company_id, year, month);

ALTER TABLE billing_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_adjustments_select"
  ON billing_adjustments FOR SELECT
  USING (is_my_company(company_id) OR is_super_admin());

CREATE POLICY "billing_adjustments_insert"
  ON billing_adjustments FOR INSERT
  WITH CHECK (is_super_admin());


-- 1d. Add columns to billing_snapshots
ALTER TABLE billing_snapshots
  ADD COLUMN IF NOT EXISTS adjustments_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION prevent_locked_snapshot_update()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_locked = true AND NEW.is_locked = true THEN
    RAISE EXCEPTION 'Cannot update a locked billing snapshot';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_locked_snapshot ON billing_snapshots;
CREATE TRIGGER trg_prevent_locked_snapshot
  BEFORE UPDATE ON billing_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION prevent_locked_snapshot_update();


-- 1e. RPC: enable_pack
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
  FROM employees WHERE company_id = p_company_id AND status = 'active';

  -- Get pack price (custom or default)
  SELECT COALESCE(cf.custom_price, sp.per_user_price)
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


-- 1f. RPC: cancel_pack
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


-- 1g. Monthly billing rollover cron
CREATE OR REPLACE FUNCTION process_monthly_billing_rollover()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_month DATE := (CURRENT_DATE - INTERVAL '1 month');
  v_prev_year INT := EXTRACT(YEAR FROM v_prev_month)::INT;
  v_prev_mo INT := EXTRACT(MONTH FROM v_prev_month)::INT;
  v_rec RECORD;
  v_fk TEXT;
  v_feature_keys TEXT[];
BEGIN
  -- Lock previous month's snapshots
  UPDATE billing_snapshots
  SET is_locked = true
  WHERE year = v_prev_year AND month = v_prev_mo AND is_locked = false;

  -- Process all scheduled cancellations
  FOR v_rec IN
    SELECT DISTINCT company_id, feature_key
    FROM company_features
    WHERE cancellation_scheduled = true
      AND cancellation_effective_date <= CURRENT_DATE
      AND feature_key IN ('pack_a', 'pack_b')
  LOOP
    IF v_rec.feature_key = 'pack_a' THEN
      v_feature_keys := ARRAY['shifts', 'legal_timesheets', 'space_booking', 'asset_management'];
    ELSE
      v_feature_keys := ARRAY['teams_integration', 'skills_passport', 'modulr_integration', 'ai_help_agent'];
    END IF;

    -- Disable the pack
    UPDATE company_features
    SET is_enabled = false, deactivated_at = now(), cancellation_scheduled = false, cancellation_effective_date = NULL
    WHERE company_id = v_rec.company_id AND feature_key = v_rec.feature_key;

    -- Disable child features
    FOREACH v_fk IN ARRAY v_feature_keys LOOP
      UPDATE company_features
      SET is_enabled = false, deactivated_at = now(), cancellation_scheduled = false, cancellation_effective_date = NULL
      WHERE company_id = v_rec.company_id AND feature_key = v_fk;
    END LOOP;

    INSERT INTO feature_change_log (company_id, feature_key, action, notes)
    VALUES (v_rec.company_id, v_rec.feature_key, 'rollover_disabled', 'Scheduled cancellation processed by monthly rollover');
  END LOOP;
END;
$$;

-- Schedule the cron job (1st of each month at 00:05 UTC)
SELECT cron.schedule(
  'process-monthly-billing-rollover',
  '5 0 1 * *',
  $$SELECT process_monthly_billing_rollover()$$
);


-- 1h. Update delete_company_data to include new tables
CREATE OR REPLACE FUNCTION delete_company_data(p_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can delete company data';
  END IF;

  DELETE FROM billing_adjustments WHERE company_id = p_company_id;
  DELETE FROM feature_change_log WHERE company_id = p_company_id;
  DELETE FROM ai_help_usage WHERE company_id = p_company_id;
  DELETE FROM help_search_logs WHERE company_id = p_company_id;
  DELETE FROM help_articles WHERE company_id = p_company_id;
  DELETE FROM survey_responses WHERE survey_id IN (SELECT id FROM surveys WHERE company_id = p_company_id);
  DELETE FROM survey_questions WHERE survey_id IN (SELECT id FROM surveys WHERE company_id = p_company_id);
  DELETE FROM surveys WHERE company_id = p_company_id;
  DELETE FROM shift_corrections WHERE company_id = p_company_id;
  DELETE FROM shift_swap_requests WHERE company_id = p_company_id;
  DELETE FROM shift_assignments WHERE company_id = p_company_id;
  DELETE FROM shift_templates WHERE company_id = p_company_id;
  DELETE FROM rotas WHERE company_id = p_company_id;
  DELETE FROM payroll_audit_log WHERE company_id = p_company_id;
  DELETE FROM payslips WHERE company_id = p_company_id;
  DELETE FROM timesheet_entries WHERE company_id = p_company_id;
  DELETE FROM timesheets WHERE company_id = p_company_id;
  DELETE FROM check_in_records WHERE company_id = p_company_id;
  DELETE FROM check_in_policies WHERE company_id = p_company_id;
  DELETE FROM leave_requests WHERE company_id = p_company_id;
  DELETE FROM leave_balances WHERE company_id = p_company_id;
  DELETE FROM leave_types WHERE company_id = p_company_id;
  DELETE FROM expense_claims WHERE company_id = p_company_id;
  DELETE FROM expense_categories WHERE company_id = p_company_id;
  DELETE FROM performance_reviews WHERE company_id = p_company_id;
  DELETE FROM review_cycles WHERE company_id = p_company_id;
  DELETE FROM objectives WHERE company_id = p_company_id;
  DELETE FROM kudos WHERE company_id = p_company_id;
  DELETE FROM elearning_enrolments WHERE company_id = p_company_id;
  DELETE FROM elearning_courses WHERE company_id = p_company_id;
  DELETE FROM elearning_categories WHERE company_id = p_company_id;
  DELETE FROM benefit_enrolments WHERE company_id = p_company_id;
  DELETE FROM benefit_types WHERE company_id = p_company_id;
  DELETE FROM space_bookings WHERE company_id = p_company_id;
  DELETE FROM space_equipment WHERE company_id = p_company_id;
  DELETE FROM spaces WHERE company_id = p_company_id;
  DELETE FROM assets WHERE company_id = p_company_id;
  DELETE FROM asset_categories WHERE company_id = p_company_id;
  DELETE FROM skill_endorsements WHERE company_id = p_company_id;
  DELETE FROM employee_skills WHERE company_id = p_company_id;
  DELETE FROM skill_categories WHERE company_id = p_company_id;
  DELETE FROM employee_consents WHERE company_id = p_company_id;
  DELETE FROM notifications WHERE company_id = p_company_id;
  DELETE FROM onboarding_tasks WHERE company_id = p_company_id;
  DELETE FROM documents WHERE company_id = p_company_id;
  DELETE FROM company_teams_config WHERE company_id = p_company_id;
  DELETE FROM xero_integrations WHERE company_id = p_company_id;
  DELETE FROM sage_integrations WHERE company_id = p_company_id;
  DELETE FROM modulr_integrations WHERE company_id = p_company_id;
  DELETE FROM zero_hours_config WHERE company_id = p_company_id;
  DELETE FROM zero_hours_assessments WHERE company_id = p_company_id;
  DELETE FROM onboarding_workflow_settings WHERE company_id = p_company_id;
  DELETE FROM billing_snapshots WHERE company_id = p_company_id;
  DELETE FROM company_features WHERE company_id = p_company_id;
  DELETE FROM employees WHERE company_id = p_company_id;
  DELETE FROM company_users WHERE company_id = p_company_id;
  DELETE FROM companies WHERE id = p_company_id;
END;
$$;


-- Update export_company_data to include new tables
CREATE OR REPLACE FUNCTION export_company_data(p_company_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_company jsonb;
  v_company_name text;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT name INTO v_company_name FROM companies WHERE id = p_company_id;
  SELECT to_jsonb(c) INTO v_company FROM companies c WHERE c.id = p_company_id;

  SELECT jsonb_build_object(
    'export_metadata', jsonb_build_object(
      'format',        'InflowHR Company Export v1',
      'exported_at',   now(),
      'company_id',    p_company_id,
      'company_name',  v_company_name,
      'gdpr_article',  'Art. 28(3)(g) — Return or delete all personal data after services end',
      'export_type',   'cancellation'
    ),

    'company',              v_company,
    'employees',            COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employees            r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'company_users',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_users        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'leave_types',          COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_types          r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'leave_requests',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_requests       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'leave_balances',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM leave_balances       r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'payslips',             COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM payslips             r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'expense_claims',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_claims       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'expense_line_items',   COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM expense_line_items   r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'timesheets',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM timesheets           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'performance_reviews',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM performance_reviews  r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'kudos',                COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM kudos                r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'benefits',             COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefits             r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_types',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_types        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_options',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_options      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'benefit_enrollments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM benefit_enrollments  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'employee_benefits',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_benefits    r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    'rotas',                COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM rotas                r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_templates',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_templates      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_assignments',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_assignments    r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'shift_swap_requests',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM shift_swap_requests  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'employee_availability',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_availability r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'legal_clients',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_clients        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'legal_matters',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_matters        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'legal_timesheet_entries', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM legal_timesheet_entries r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'hr_tickets',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM hr_tickets           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'one_to_one_meetings',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_meetings  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'one_to_one_comments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM one_to_one_comments  r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'onboarding',           COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM onboarding           r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'announcements',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM announcements        r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'notifications',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM notifications        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'workflow_tracker',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM workflow_tracker     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'app_settings',         COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM app_settings         r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'company_features',     COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_features     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'company_elearning_courses', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_elearning_courses r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'courses',              COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM courses              r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'course_enrolments',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM course_enrolments    r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    'checkin_records',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM checkin_records      r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'break_records',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM break_records        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'space_bookings',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM space_bookings       r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    'employee_skills',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_skills      r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'employee_certifications', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_certifications r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),
    'skill_evidence',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM skill_evidence       r WHERE r.employee_skill_id IN (SELECT id FROM employee_skills WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id))), '[]'::jsonb),
    'skill_validations',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM skill_validations    r WHERE r.employee_skill_id IN (SELECT id FROM employee_skills WHERE employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id))), '[]'::jsonb),

    'company_assets',       COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM company_assets       r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'asset_updates',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM asset_updates        r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'employee_consents',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM employee_consents    r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'billing_snapshots',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM billing_snapshots    r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'billing_adjustments',  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM billing_adjustments  r WHERE r.company_id = p_company_id), '[]'::jsonb),
    'feature_change_log',   COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM feature_change_log   r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'user_settings',        COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM user_settings        r WHERE r.employee_id IN (SELECT id FROM employees WHERE company_id = p_company_id)), '[]'::jsonb),

    'gdpr_audit_logs',      COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM gdpr_audit_logs     r WHERE r.company_id = p_company_id), '[]'::jsonb),

    'tenant_support_access', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM tenant_support_access r WHERE r.company_id = p_company_id), '[]'::jsonb)
  ) INTO v_result;

  PERFORM log_gdpr_action(
    auth.uid(), 'super_admin', p_company_id,
    NULL, 'companies', p_company_id::text,
    'COMPANY_DATA_EXPORTED', NULL, NULL,
    jsonb_build_object(
      'export_type', 'cancellation',
      'gdpr_article', 'Art. 28(3)(g)'
    )
  );

  RETURN v_result;
END;
$$;


-- Permissions
REVOKE EXECUTE ON FUNCTION enable_pack(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION enable_pack(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION cancel_pack(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_pack(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION process_monthly_billing_rollover() FROM anon;
