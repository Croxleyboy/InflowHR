-- 164_unified_payroll.sql
-- Unified payroll infrastructure: pay runs, payslip linkage, timesheet check-in bridge,
-- and data migration from employees.pay_frequency to pay_pattern_override.

-- ============================================================================
-- 1. Pay runs table — tracks payroll run history per company
-- ============================================================================
CREATE TABLE IF NOT EXISTS pay_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'bi_weekly', 'monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'exported', 'synced', 'released')),
  payment_method TEXT CHECK (payment_method IN ('external', 'bacs', 'xero', 'sage', 'modulr')),
  worker_types TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(company_id, frequency, period_start, period_end)
);

-- ============================================================================
-- 2. RLS on pay_runs — scoped to company membership or super admin
-- ============================================================================
ALTER TABLE pay_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pay_runs' AND policyname = 'pay_runs_company'
  ) THEN
    CREATE POLICY "pay_runs_company" ON pay_runs
      FOR ALL USING (
        company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true)
        OR is_super_admin()
      );
  END IF;
END $$;

-- ============================================================================
-- 3. Link payslips to a pay run
-- ============================================================================
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS pay_run_id UUID REFERENCES pay_runs(id);

-- ============================================================================
-- 4. Timesheet check-in bridge columns
-- ============================================================================
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS source_checkin_id UUID REFERENCES checkin_records(id);
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'checkin', 'adjusted'));

-- ============================================================================
-- 5. Deprecate employees.pay_frequency — migrate existing values to
--    pay_pattern_override where the override has not already been set.
--    The pay_frequency column is NOT dropped; a later cleanup migration will
--    remove it once all consumers have switched.
-- ============================================================================
UPDATE employees SET pay_pattern_override =
  CASE pay_frequency
    WHEN 'weekly'      THEN 'weekly'
    WHEN 'fortnightly' THEN 'bi_weekly'
    WHEN 'four_weekly' THEN 'bi_weekly'
    WHEN 'monthly'     THEN 'monthly'
  END
WHERE pay_frequency IS NOT NULL
  AND pay_frequency != ''
  AND pay_pattern_override IS NULL;

-- ============================================================================
-- 6. Indexes for new columns
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_timesheets_source ON timesheets(source);
CREATE INDEX IF NOT EXISTS idx_timesheets_source_checkin ON timesheets(source_checkin_id) WHERE source_checkin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payslips_pay_run ON payslips(pay_run_id) WHERE pay_run_id IS NOT NULL;
