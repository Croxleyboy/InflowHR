CREATE TABLE IF NOT EXISTS expense_export_log (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  exported_by TEXT NOT NULL,
  file_name TEXT NOT NULL,
  export_date DATE NOT NULL DEFAULT CURRENT_DATE,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, exported_by, export_date)
);

ALTER TABLE expense_export_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_export_log_company_access" ON expense_export_log
  FOR ALL USING (can_access_company(company_id));
