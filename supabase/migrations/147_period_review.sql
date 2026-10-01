-- Migration 147: Period Review for shift/zero-hours payroll
-- Adds hourly rate + pay frequency to employees, creates pay_period_reviews and payroll_exports

-- ── Employee columns for hourly pay ──────────────────────────────────────────

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS pay_frequency text DEFAULT 'monthly'
    CHECK (pay_frequency IN ('weekly', 'fortnightly', 'four_weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS overtime_rate_multiplier numeric(3,2) DEFAULT 1.50;


-- ── Pay period reviews ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pay_period_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  total_hours     numeric(8,2) NOT NULL DEFAULT 0,
  adjusted_hours  numeric(8,2),
  overtime_hours  numeric(8,2) NOT NULL DEFAULT 0,
  hourly_rate     numeric(10,2) NOT NULL,
  gross_pay       numeric(10,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'exported', 'paid')),
  approved_by     uuid REFERENCES auth.users(id),
  approved_at     timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, period_start)
);

ALTER TABLE pay_period_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ppr_select" ON pay_period_reviews FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ppr_insert" ON pay_period_reviews FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ppr_update" ON pay_period_reviews FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ppr_delete" ON pay_period_reviews FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE INDEX idx_ppr_company ON pay_period_reviews(company_id);
CREATE INDEX idx_ppr_employee ON pay_period_reviews(employee_id);
CREATE INDEX idx_ppr_period ON pay_period_reviews(period_start, period_end);
CREATE INDEX idx_ppr_status ON pay_period_reviews(status);


-- ── Payroll exports audit trail ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_exports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  export_target   text NOT NULL CHECK (export_target IN ('sage', 'xero', 'csv')),
  employee_count  int NOT NULL DEFAULT 0,
  total_gross     numeric(12,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'exported'
    CHECK (status IN ('exported', 'synced', 'failed')),
  exported_by     uuid REFERENCES auth.users(id),
  exported_at     timestamptz NOT NULL DEFAULT now(),
  synced_at       timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payroll_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pe_select" ON payroll_exports FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "pe_insert" ON payroll_exports FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "pe_update" ON payroll_exports FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "pe_delete" ON payroll_exports FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE INDEX idx_pe_company ON payroll_exports(company_id);
CREATE INDEX idx_pe_period ON payroll_exports(period_start, period_end);
