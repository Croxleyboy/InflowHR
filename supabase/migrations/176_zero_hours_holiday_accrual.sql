-- Zero Hours Accrued Holiday Leave — UK Statutory Compliance
-- Supports two methods: rolled-up holiday pay (default) and accrual-based paid leave
-- Compliant with UK Working Time Regulations 1998, amended 2024

-- 1. Worker type settings: holiday accrual rate + method
ALTER TABLE worker_type_settings
  ADD COLUMN IF NOT EXISTS holiday_accrual_rate NUMERIC(5,2) DEFAULT 12.07,
  ADD COLUMN IF NOT EXISTS holiday_pay_method TEXT DEFAULT 'rolled_up'
    CHECK (holiday_pay_method IN ('accrual', 'rolled_up'));

-- 2. Leave balances: widen total_allowance from INTEGER to NUMERIC for hours-based tracking
ALTER TABLE leave_balances
  ALTER COLUMN total_allowance TYPE NUMERIC(8,2);

ALTER TABLE leave_balances
  ADD COLUMN IF NOT EXISTS accrual_unit TEXT DEFAULT 'days'
    CHECK (accrual_unit IN ('days', 'hours'));

-- 3. Payslips: separate holiday pay line item
ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS holiday_pay NUMERIC(10,2) DEFAULT 0;

-- 4. Leave requests: unit column so zero hours requests store hours not days
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'days'
    CHECK (unit IN ('days', 'hours'));

-- 5. Holiday accrual audit log
CREATE TABLE IF NOT EXISTS holiday_accrual_log (
  id SERIAL PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  hours_worked NUMERIC(8,2) NOT NULL,
  accrual_rate NUMERIC(5,2) NOT NULL,
  hours_accrued_raw NUMERIC(8,2) NOT NULL,
  hours_accrued_rounded NUMERIC(8,2) NOT NULL,
  holiday_pay_amount NUMERIC(10,2) DEFAULT 0,
  method TEXT NOT NULL CHECK (method IN ('accrual', 'rolled_up')),
  payslip_id BIGINT REFERENCES payslips(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS on holiday_accrual_log
ALTER TABLE holiday_accrual_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holiday_accrual_log_select" ON holiday_accrual_log
  FOR SELECT USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "holiday_accrual_log_insert" ON holiday_accrual_log
  FOR INSERT WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "holiday_accrual_log_update" ON holiday_accrual_log
  FOR UPDATE USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "holiday_accrual_log_delete" ON holiday_accrual_log
  FOR DELETE USING (is_super_admin());

-- 6. RPC: atomic accrual of holiday hours into leave_balances
CREATE OR REPLACE FUNCTION accrue_holiday_hours(
  p_employee_id UUID,
  p_company_id UUID,
  p_year INT,
  p_hours NUMERIC
) RETURNS VOID AS $$
DECLARE
  v_leave_type_id BIGINT;
BEGIN
  SELECT id INTO v_leave_type_id
    FROM leave_types
    WHERE company_id = p_company_id AND name = 'Annual Leave'
    LIMIT 1;

  IF v_leave_type_id IS NULL THEN
    RAISE EXCEPTION 'Annual Leave type not found for company %', p_company_id;
  END IF;

  INSERT INTO leave_balances (employee_id, leave_type_id, year, total_allowance, used, carried_over, company_id, accrual_unit)
  VALUES (p_employee_id, v_leave_type_id, p_year, p_hours, 0, 0, p_company_id, 'hours')
  ON CONFLICT (employee_id, leave_type_id, year)
  DO UPDATE SET total_allowance = leave_balances.total_allowance + p_hours,
               accrual_unit = 'hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Data migration: fix existing zero hours workers' leave balances
UPDATE leave_balances lb
SET accrual_unit = 'hours', total_allowance = 0
FROM employees e
WHERE lb.employee_id = e.id
  AND e.employment_category = 'shift_worker'
  AND e.contract_type = 'Zero hours shift worker';
