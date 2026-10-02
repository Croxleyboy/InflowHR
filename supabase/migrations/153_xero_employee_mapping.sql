-- Add persistent Xero employee ID mapping to employees table
-- Enables reliable payslip sync without depending on email matching
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS xero_employee_id TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_xero_employee_id
  ON employees (xero_employee_id)
  WHERE xero_employee_id IS NOT NULL;
