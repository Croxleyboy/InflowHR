-- 167: Add UK payroll classification columns to benefit_types
-- and sync_benefits_to_xero toggle on xero_integrations.

-- Benefit category — determines how Xero/Sage categorises the line
ALTER TABLE benefit_types ADD COLUMN IF NOT EXISTS benefit_category TEXT
  DEFAULT 'allowance'
  CHECK (benefit_category IN ('reimbursement', 'allowance', 'deduction', 'salary_sacrifice', 'bik'));

-- How the benefit amount affects the payslip
ALTER TABLE benefit_types ADD COLUMN IF NOT EXISTS pay_impact TEXT
  DEFAULT 'no_impact'
  CHECK (pay_impact IN ('add_to_gross', 'add_to_net', 'reduce_gross', 'reduce_net', 'no_impact'));

-- PAYE tax treatment
ALTER TABLE benefit_types ADD COLUMN IF NOT EXISTS tax_treatment TEXT
  DEFAULT 'taxable'
  CHECK (tax_treatment IN ('taxable', 'non_taxable', 'pre_tax', 'post_tax'));

-- National Insurance treatment
ALTER TABLE benefit_types ADD COLUMN IF NOT EXISTS ni_treatment TEXT
  DEFAULT 'subject_to_ni'
  CHECK (ni_treatment IN ('subject_to_ni', 'exempt_ni', 'class_1a_employer'));

-- Pension treatment
ALTER TABLE benefit_types ADD COLUMN IF NOT EXISTS pension_treatment TEXT
  DEFAULT 'non_pensionable'
  CHECK (pension_treatment IN ('pensionable', 'non_pensionable'));

-- Xero Pay Item mapping
ALTER TABLE benefit_types ADD COLUMN IF NOT EXISTS xero_pay_item_id TEXT;
ALTER TABLE benefit_types ADD COLUMN IF NOT EXISTS xero_pay_item_category TEXT
  CHECK (xero_pay_item_category IS NULL OR xero_pay_item_category IN ('Earning', 'Deduction', 'Benefit', 'Reimbursement'));

-- Master toggle: include benefits in Xero sync (default OFF)
ALTER TABLE xero_integrations ADD COLUMN IF NOT EXISTS sync_benefits_to_xero BOOLEAN DEFAULT false;
