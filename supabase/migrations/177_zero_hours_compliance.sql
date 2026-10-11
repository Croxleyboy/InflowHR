-- 177_zero_hours_compliance.sql
-- Zero hours compliance engine: predictable hours monitoring, shift cancellation
-- compensation, pension auto-enrolment tracking, guaranteed hours transition.
-- All functionality gated behind a per-company toggle (default OFF).

-- ============================================================
-- 1. Company-level compliance settings (toggle + config)
-- ============================================================
CREATE TABLE IF NOT EXISTS zero_hours_compliance_settings (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  cancellation_notice_hours INTEGER DEFAULT 48 CHECK (cancellation_notice_hours BETWEEN 24 AND 168),
  pension_threshold NUMERIC(10,2) DEFAULT 10000,
  predictable_hours_qualifying_weeks INTEGER DEFAULT 12 CHECK (predictable_hours_qualifying_weeks BETWEEN 4 AND 52),
  guaranteed_hours_overtime_rate NUMERIC(5,2) DEFAULT 12.07,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id)
);

ALTER TABLE zero_hours_compliance_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zhc_settings_select" ON zero_hours_compliance_settings
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "zhc_settings_insert" ON zero_hours_compliance_settings
  FOR INSERT WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "zhc_settings_update" ON zero_hours_compliance_settings
  FOR UPDATE USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "zhc_settings_delete" ON zero_hours_compliance_settings
  FOR DELETE USING (company_id = get_my_company_id() OR is_super_admin());

-- ============================================================
-- 2. Predictable hours requests
-- ============================================================
CREATE TABLE IF NOT EXISTS predictable_hours_requests (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weeks_of_service INTEGER NOT NULL,
  average_weekly_hours NUMERIC(6,2) NOT NULL,
  offered_weekly_hours NUMERIC(6,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'offered', 'accepted', 'declined', 'withdrawn')),
  offered_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  admin_notes TEXT,
  employee_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE predictable_hours_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "phr_select" ON predictable_hours_requests
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "phr_insert" ON predictable_hours_requests
  FOR INSERT WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "phr_update" ON predictable_hours_requests
  FOR UPDATE USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "phr_delete" ON predictable_hours_requests
  FOR DELETE USING (company_id = get_my_company_id() OR is_super_admin());

-- ============================================================
-- 3. Shift cancellation log
-- ============================================================
CREATE TABLE IF NOT EXISTS shift_cancellation_log (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_start TIME NOT NULL,
  shift_end TIME NOT NULL,
  shift_hours NUMERIC(6,2) NOT NULL,
  cancellation_type TEXT NOT NULL CHECK (cancellation_type IN ('cancelled', 'shortened', 'rescheduled')),
  notice_hours NUMERIC(8,2) NOT NULL,
  within_notice_window BOOLEAN DEFAULT false,
  compensation_amount NUMERIC(10,2) DEFAULT 0,
  compensation_included_in_payrun BOOLEAN DEFAULT false,
  pay_run_id BIGINT,
  cancelled_by UUID REFERENCES auth.users(id),
  cancelled_at TIMESTAMPTZ DEFAULT now(),
  original_shift_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE shift_cancellation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scl_select" ON shift_cancellation_log
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "scl_insert" ON shift_cancellation_log
  FOR INSERT WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "scl_update" ON shift_cancellation_log
  FOR UPDATE USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "scl_delete" ON shift_cancellation_log
  FOR DELETE USING (company_id = get_my_company_id() OR is_super_admin());

-- ============================================================
-- 4. Employee columns for pension and guaranteed hours
-- ============================================================
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pension_auto_enrolled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pension_enrolled_date DATE,
  ADD COLUMN IF NOT EXISTS guaranteed_hours_approved BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS guaranteed_weekly_hours NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guaranteed_hours_start_date DATE;

-- ============================================================
-- 5. Function to calculate weeks of zero hours service
-- ============================================================
CREATE OR REPLACE FUNCTION get_zero_hours_service_weeks(p_employee_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_start_date DATE;
  v_weeks INTEGER;
BEGIN
  SELECT start_date INTO v_start_date
  FROM employees
  WHERE id = p_employee_id
    AND employment_category = 'shift_worker'
    AND contract_type = 'Zero hours shift worker';

  IF v_start_date IS NULL THEN
    RETURN 0;
  END IF;

  v_weeks := EXTRACT(DAY FROM (CURRENT_DATE - v_start_date)) / 7;
  RETURN COALESCE(v_weeks, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 6. Function to get average weekly hours from check-in records
-- ============================================================
CREATE OR REPLACE FUNCTION get_zero_hours_avg_weekly_hours(
  p_employee_id UUID,
  p_weeks INTEGER DEFAULT 12
)
RETURNS NUMERIC AS $$
DECLARE
  v_total_hours NUMERIC;
  v_start_date DATE;
BEGIN
  v_start_date := CURRENT_DATE - (p_weeks * 7);

  SELECT COALESCE(SUM(
    EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 3600.0
    - COALESCE(break_minutes, 0) / 60.0
  ), 0)
  INTO v_total_hours
  FROM checkin_records
  WHERE employee_id = p_employee_id
    AND check_in_time >= v_start_date
    AND check_out_time IS NOT NULL;

  IF p_weeks <= 0 THEN RETURN 0; END IF;
  RETURN ROUND(v_total_hours / p_weeks, 2);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 7. Function to get YTD earnings for pension threshold check
-- ============================================================
CREATE OR REPLACE FUNCTION get_zero_hours_ytd_earnings(
  p_employee_id UUID,
  p_financial_year_start DATE DEFAULT NULL
)
RETURNS NUMERIC AS $$
DECLARE
  v_fy_start DATE;
  v_total NUMERIC;
BEGIN
  IF p_financial_year_start IS NULL THEN
    IF EXTRACT(MONTH FROM CURRENT_DATE) >= 4 THEN
      v_fy_start := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INT, 4, 6);
    ELSE
      v_fy_start := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INT - 1, 4, 6);
    END IF;
  ELSE
    v_fy_start := p_financial_year_start;
  END IF;

  SELECT COALESCE(SUM(gross_pay + COALESCE(holiday_pay, 0)), 0)
  INTO v_total
  FROM payslips
  WHERE employee_id = p_employee_id
    AND pay_date >= v_fy_start;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
