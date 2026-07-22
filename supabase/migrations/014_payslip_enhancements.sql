-- 014: Extend payslips table for full UK salary slip data

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS overtime DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS adjustments DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS monthly_deductions DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS tax_code TEXT DEFAULT '1257L';
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS annual_salary DECIMAL(10,2);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS payroll_id TEXT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS bank_account TEXT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS payroll_office TEXT;

-- Update existing payslips with UK payroll data
UPDATE payslips SET
  overtime = 0,
  adjustments = 230.00,
  monthly_deductions = 0,
  tax_code = '1257L',
  annual_salary = 76000.00,
  payroll_id = '444',
  bank_account = '5435453454',
  payroll_office = 'Kumonix HQ, Building 101, Room 15, HA5 YT4'
WHERE employee_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

-- Seed remaining financial year months (Apr 2026 back to Apr 2026 start)
-- FY runs Apr-Mar; seed Apr 2026 payslip
INSERT INTO payslips (employee_id, reference_number, pay_period_start, pay_period_end, gross_pay, tax, national_insurance, pension, other_deductions, net_pay, payment_date, status, overtime, adjustments, monthly_deductions, tax_code, annual_salary, payroll_id, bank_account, payroll_office)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'PAY-2026-04', '2026-04-01', '2026-04-30', 4500.00, 720.00, 360.00, 225.00, 0, 3195.00, '2026-04-28', 'paid', 0, 230.00, 0, '1257L', 76000.00, '444', '5435453454', 'Kumonix HQ, Building 101, Room 15, HA5 YT4')
ON CONFLICT (reference_number) DO NOTHING;
