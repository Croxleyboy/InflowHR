-- Migration 168: Add recurring bonus fields to employees + payroll_adjustments table

-- Recurring bonus flag on employee profiles
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_frequency TEXT DEFAULT NULL
    CHECK (bonus_frequency IN ('weekly', 'monthly'));

-- One-off payroll adjustments (bonuses, deductions) per pay run
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pay_run_id UUID REFERENCES pay_runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('bonus', 'deduction', 'allowance')),
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  frequency TEXT DEFAULT 'one_off' CHECK (frequency IN ('one_off', 'recurring')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'pushed', 'cancelled')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_adjustments_company_read" ON payroll_adjustments
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true)
    OR is_super_admin()
  );

CREATE POLICY "payroll_adjustments_admin_write" ON payroll_adjustments
  FOR ALL USING (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'hr') AND is_active = true)
    OR is_super_admin()
  );

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_company ON payroll_adjustments(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_employee ON payroll_adjustments(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_pay_run ON payroll_adjustments(pay_run_id);
