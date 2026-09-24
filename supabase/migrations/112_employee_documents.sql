-- Employee documents: secure document storage per employee
-- Categories: Right to Work, Contracts, Absence, Performance, Employee Relations, Offboarding

CREATE TABLE IF NOT EXISTS employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'right_to_work',
    'contracts',
    'absence',
    'performance',
    'employee_relations',
    'offboarding'
  )),
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  expiry_date date,
  notes text,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX idx_employee_documents_company ON employee_documents(company_id);
CREATE INDEX idx_employee_documents_category ON employee_documents(category);
CREATE INDEX idx_employee_documents_expiry ON employee_documents(expiry_date) WHERE expiry_date IS NOT NULL;

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_documents_select"
  ON employee_documents FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "employee_documents_insert"
  ON employee_documents FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "employee_documents_update"
  ON employee_documents FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "employee_documents_delete"
  ON employee_documents FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

-- Storage bucket for employee documents (private, no public access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-documents', 'employee-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: scoped to company via path structure {company_id}/{employee_id}/{filename}
CREATE POLICY "employee_docs_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'employee-documents'
    AND (
      (storage.foldername(name))[1]::uuid = get_my_company_id()
      OR is_super_admin()
    )
  );

CREATE POLICY "employee_docs_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'employee-documents'
    AND (
      (storage.foldername(name))[1]::uuid = get_my_company_id()
      OR is_super_admin()
    )
  );

CREATE POLICY "employee_docs_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'employee-documents'
    AND (
      (storage.foldername(name))[1]::uuid = get_my_company_id()
      OR is_super_admin()
    )
  );

CREATE POLICY "employee_docs_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'employee-documents'
    AND (
      (storage.foldername(name))[1]::uuid = get_my_company_id()
      OR is_super_admin()
    )
  );
