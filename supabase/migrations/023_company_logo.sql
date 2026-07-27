-- Add logo_url column to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Create storage bucket for company logos (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to company-logos bucket
CREATE POLICY "Authenticated users can upload company logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-logos');

CREATE POLICY "Authenticated users can update company logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-logos');

CREATE POLICY "Anyone can view company logos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'company-logos');
