-- ============================================================
-- Timesheets table + RLS policies
-- ============================================================

CREATE TABLE IF NOT EXISTS timesheets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employees(id),
  location text NOT NULL,
  customer text,
  role text NOT NULL,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  hours numeric(5,2) GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0
  ) STORED,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  submitted_at timestamptz,
  approved_by uuid REFERENCES employees(id),
  approved_at timestamptz,
  company_id uuid NOT NULL REFERENCES companies(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Timesheet company read"   ON timesheets;
DROP POLICY IF EXISTS "Timesheet company insert"  ON timesheets;
DROP POLICY IF EXISTS "Timesheet company update"  ON timesheets;
DROP POLICY IF EXISTS "Timesheet company delete"  ON timesheets;

CREATE POLICY "Timesheet company read"   ON timesheets FOR SELECT USING (
  company_id = get_my_company_id() OR is_super_admin()
);
CREATE POLICY "Timesheet company insert" ON timesheets FOR INSERT WITH CHECK (
  company_id = get_my_company_id() OR is_super_admin()
);
CREATE POLICY "Timesheet company update" ON timesheets FOR UPDATE USING (
  company_id = get_my_company_id() OR is_super_admin()
);
CREATE POLICY "Timesheet company delete" ON timesheets FOR DELETE USING (
  company_id = get_my_company_id() OR is_super_admin()
);

CREATE INDEX IF NOT EXISTS idx_timesheets_employee ON timesheets(employee_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_company  ON timesheets(company_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_date     ON timesheets(date DESC);
