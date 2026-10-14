-- Platform-level secrets (API keys, credentials) managed by super admins only
CREATE TABLE IF NOT EXISTS platform_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name TEXT NOT NULL UNIQUE,
  key_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE platform_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins only"
  ON platform_secrets FOR ALL
  USING (is_super_admin());
