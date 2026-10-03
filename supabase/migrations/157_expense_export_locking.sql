-- Expense export locking: add processing/paid statuses, export IDs, and audit entries table

-- 1. Expand the status CHECK constraint to include 'processing' and 'paid'
ALTER TABLE public.expense_claims DROP CONSTRAINT IF EXISTS expense_claims_status_check;
ALTER TABLE public.expense_claims ADD CONSTRAINT expense_claims_status_check
  CHECK (status IN ('draft', 'submitted', 'pending', 'approved', 'rejected', 'processing', 'paid'));

-- 2. Add expense_export_id column to track which export batch locked each claim
ALTER TABLE expense_claims
  ADD COLUMN IF NOT EXISTS expense_export_id TEXT;

-- 3. Create expense_export_entries table for per-claim audit trail
CREATE TABLE IF NOT EXISTS expense_export_entries (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  expense_export_id TEXT NOT NULL,
  expense_claim_id INTEGER NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
  reference_number TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  export_type TEXT NOT NULL DEFAULT 'zip',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_export_entries_company
  ON expense_export_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_expense_export_entries_export_id
  ON expense_export_entries(expense_export_id);
CREATE INDEX IF NOT EXISTS idx_expense_export_entries_claim
  ON expense_export_entries(expense_claim_id);

ALTER TABLE expense_export_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_export_entries_company_access" ON expense_export_entries
  FOR ALL USING (can_access_company(company_id));
