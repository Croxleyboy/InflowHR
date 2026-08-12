-- Offboarding records
CREATE TABLE IF NOT EXISTS offboarding (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  employee_name TEXT NOT NULL,
  employee_email TEXT NOT NULL,
  job_title TEXT,
  department TEXT,
  end_date DATE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  workflow_steps JSONB NOT NULL DEFAULT '{}',
  skipped_steps JSONB NOT NULL DEFAULT '{}',
  is_complete BOOLEAN NOT NULL DEFAULT false,
  frozen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE offboarding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "offboarding_company_access" ON offboarding
  FOR ALL USING (can_access_company(company_id));

-- Frozen employees queue
CREATE TABLE IF NOT EXISTS frozen_employees (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  employee_name TEXT NOT NULL,
  employee_email TEXT NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deletion_date DATE NOT NULL DEFAULT (CURRENT_DATE + 30),
  status TEXT NOT NULL DEFAULT 'awaiting_expiry',
  recovered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, employee_id)
);

ALTER TABLE frozen_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "frozen_employees_company_access" ON frozen_employees
  FOR ALL USING (can_access_company(company_id));

-- Add is_frozen flag to employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT false;
