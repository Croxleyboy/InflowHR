-- Migration 190: Guest user access system
-- Allows company admins to create time-limited guest accounts for external users
-- to access specific admin portal features with configurable permissions

CREATE TABLE IF NOT EXISTS guest_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  role_key TEXT NOT NULL DEFAULT 'read_only',
  read_only BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  otp_expires_at TIMESTAMPTZ NOT NULL,
  auth_user_id UUID,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  UNIQUE(company_id, email)
);

CREATE INDEX idx_guest_users_company ON guest_users(company_id);
CREATE INDEX idx_guest_users_email ON guest_users(email);
CREATE INDEX idx_guest_users_auth_user ON guest_users(auth_user_id);

ALTER TABLE guest_users ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read guest_users for their company, or their own guest entries
CREATE POLICY guest_users_select ON guest_users FOR SELECT TO authenticated
  USING (
    company_id = get_my_company_id()
    OR is_super_admin()
    OR auth_user_id = auth.uid()
  );

-- Only admins can insert/update/delete guest users
CREATE POLICY guest_users_insert ON guest_users FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    OR is_super_admin()
  );

-- Admins can update any guest in their company; guests can update their own row (for last_login_at)
CREATE POLICY guest_users_update ON guest_users FOR UPDATE TO authenticated
  USING (
    company_id = get_my_company_id()
    OR is_super_admin()
    OR auth_user_id = auth.uid()
  );

CREATE POLICY guest_users_delete ON guest_users FOR DELETE TO authenticated
  USING (
    company_id = get_my_company_id()
    OR is_super_admin()
  );

-- Service role can do everything (for edge function)
CREATE POLICY guest_users_service ON guest_users FOR ALL TO service_role
  USING (true) WITH CHECK (true);
