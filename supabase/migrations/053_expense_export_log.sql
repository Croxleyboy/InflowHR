CREATE TABLE IF NOT EXISTS expense_export_log (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  exported_by TEXT NOT NULL,
  file_name TEXT NOT NULL,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS expense_export_log_one_per_day
  ON expense_export_log (company_id, exported_by, (exported_at::date));

ALTER TABLE expense_export_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_export_log_company_access" ON expense_export_log
  FOR ALL USING (can_access_company(company_id));
