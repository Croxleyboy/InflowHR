-- Add visible_to_employee column to employee_documents
-- Default false: admin uploads are not visible to the employee unless explicitly toggled
ALTER TABLE employee_documents
  ADD COLUMN visible_to_employee BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for employee-facing document queries
CREATE INDEX idx_employee_documents_visible
  ON employee_documents (employee_id, company_id)
  WHERE visible_to_employee = TRUE;
