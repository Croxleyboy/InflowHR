-- Billing snapshots: freeze monthly billing so price changes only affect current + future months
-- feature_details stores per-addon breakdown as JSONB: [{"key":"expenses","name":"Expenses","price":1.50}, ...]
CREATE TABLE IF NOT EXISTS billing_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  employee_count INT NOT NULL DEFAULT 0,
  core_per_user NUMERIC(10,2) NOT NULL DEFAULT 0,
  addon_per_user NUMERIC(10,2) NOT NULL DEFAULT 0,
  feature_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_billing_snapshots_company
  ON billing_snapshots(company_id, year, month);

ALTER TABLE billing_snapshots ENABLE ROW LEVEL SECURITY;

-- Company admins can read their own company's snapshots
CREATE POLICY "billing_snapshots_select"
  ON billing_snapshots FOR SELECT
  USING (is_my_company(company_id) OR is_super_admin());

-- Company admins can insert their own company's snapshots
CREATE POLICY "billing_snapshots_insert"
  ON billing_snapshots FOR INSERT
  WITH CHECK (is_my_company(company_id) OR is_super_admin());

-- Company admins can update their own company's snapshots
CREATE POLICY "billing_snapshots_update"
  ON billing_snapshots FOR UPDATE
  USING (is_my_company(company_id) OR is_super_admin());
