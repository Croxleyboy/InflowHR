-- ── 109: Sage PDF Upload — replace API/OAuth with PDF import ─────────────────
-- Sage does not expose a public payroll API, so we switch from OAuth-based
-- API sync to PDF upload + parse. The admin's accountant exports a monthly
-- multi-page payslip PDF from Sage and uploads it via the admin panel.

-- ── Drop API/OAuth columns from sage_integrations ────────────────────────────
ALTER TABLE sage_integrations
  DROP COLUMN IF EXISTS client_id,
  DROP COLUMN IF EXISTS client_secret_encrypted,
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token,
  DROP COLUMN IF EXISTS resource_owner_id,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS cached_pay_run,
  DROP COLUMN IF EXISTS cached_payslips;

-- ── Add upload-tracking columns ──────────────────────────────────────────────
ALTER TABLE sage_integrations
  ADD COLUMN IF NOT EXISTS last_upload_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_upload_filename text;

-- ── Storage bucket for Sage PDF uploads ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('sage-payslips', 'sage-payslips', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: company-scoped via path prefix {company_id}/
CREATE POLICY "Admin/HR can upload sage PDFs"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'sage-payslips'
    AND (storage.foldername(name))[1] = get_my_company_id()::text
    AND EXISTS (
      SELECT 1 FROM company_users
      WHERE auth_user_id = auth.uid()
      AND company_id = get_my_company_id()
      AND role IN ('admin', 'hr')
    )
  );

CREATE POLICY "Company users can read sage PDFs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'sage-payslips'
    AND (storage.foldername(name))[1] = get_my_company_id()::text
  );

CREATE POLICY "Admins can delete sage PDFs"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'sage-payslips'
    AND (storage.foldername(name))[1] = get_my_company_id()::text
    AND EXISTS (
      SELECT 1 FROM company_users
      WHERE auth_user_id = auth.uid()
      AND company_id = get_my_company_id()
      AND role = 'admin'
    )
  );
