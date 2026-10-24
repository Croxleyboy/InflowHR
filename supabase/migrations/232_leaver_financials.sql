-- ============================================================
-- 232: Leaver Financials — notice tracking and company leave
-- policy columns for the in-app holiday calculator
-- ============================================================

-- ── A. New columns on offboarding for notice tracking ──────────
ALTER TABLE offboarding
  ADD COLUMN IF NOT EXISTS notice_given_by TEXT CHECK (notice_given_by IN ('employee', 'employer')),
  ADD COLUMN IF NOT EXISTS notice_given_date DATE,
  ADD COLUMN IF NOT EXISTS leaver_calc_result JSONB;

-- ── B. Company-level leaver & leave policy settings ────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS bank_holiday_treatment TEXT NOT NULL DEFAULT 'additional'
    CHECK (bank_holiday_treatment IN ('included', 'additional', 'not_given')),
  ADD COLUMN IF NOT EXISTS bank_holidays_per_year INT NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS leave_payout_policy TEXT NOT NULL DEFAULT 'pay_out'
    CHECK (leave_payout_policy IN ('pay_out', 'must_take', 'company_decides', 'mixed')),
  ADD COLUMN IF NOT EXISTS leave_clawback_clause BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS employer_pension_rate NUMERIC(5,2) DEFAULT 3.00;
