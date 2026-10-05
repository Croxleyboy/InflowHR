-- Payroll frequency support: track pay period type on payslips
-- and link shift/zero-hours payslips back to their period review

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS pay_period_type TEXT DEFAULT 'monthly'
    CHECK (pay_period_type IN ('weekly', 'bi_weekly', 'monthly'));

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS source_review_id UUID REFERENCES pay_period_reviews(id);

-- Scheduled setting changes: effective date and impact description
ALTER TABLE worker_setting_change_log
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS impact_summary TEXT;
