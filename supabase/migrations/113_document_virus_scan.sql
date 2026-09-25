-- Add virus scan status tracking to employee_documents

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'pending'
  CHECK (scan_status IN ('pending', 'scanning', 'clean', 'infected', 'skipped', 'error', 'timeout'));

COMMENT ON COLUMN employee_documents.scan_status IS
  'Virus scan status: pending (awaiting scan), scanning (in progress), clean (passed), infected (malware detected and file removed), skipped (no scanner configured), error (scan failed), timeout (scan did not complete)';
