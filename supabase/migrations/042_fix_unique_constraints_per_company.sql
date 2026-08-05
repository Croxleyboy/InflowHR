-- Fix global unique constraints that should be scoped per company

-- employees.employee_number: unique per company, not globally
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employee_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_number_company
  ON employees (employee_number, company_id);

-- employees.email: unique per company (same person can exist in multiple companies)
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS employees_email_company
  ON employees (email, company_id);

-- leave_types.name: unique per company
ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS leave_types_name_company
  ON leave_types (name, company_id);

-- expense_claims.reference_number: unique per company
ALTER TABLE expense_claims DROP CONSTRAINT IF EXISTS expense_claims_reference_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS expense_claims_reference_number_company
  ON expense_claims (reference_number, company_id);

-- payslips.reference_number: unique per company
ALTER TABLE payslips DROP CONSTRAINT IF EXISTS payslips_reference_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS payslips_reference_number_company
  ON payslips (reference_number, company_id);
