-- Guest SSO Login
-- 1. Add auth_method column to guest_users
-- 2. Make otp_hash nullable for SSO guests
-- 3. Add platform settings for guest auth methods
-- 4. Create anon-callable RPC to expose guest auth settings
-- 5. Add index for SSO email lookup

-- ============================================================
-- 1. Add auth_method column
-- ============================================================

ALTER TABLE guest_users
  ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'otp'
  CHECK (auth_method IN ('otp', 'sso'));

-- ============================================================
-- 2. Make otp_hash nullable (SSO guests have no OTP)
-- ============================================================

ALTER TABLE guest_users ALTER COLUMN otp_hash DROP NOT NULL;

-- ============================================================
-- 3. Platform settings for guest auth methods
-- ============================================================

INSERT INTO platform_settings (key, value)
VALUES ('guest_otp_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value)
VALUES ('guest_sso_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. Anon-callable RPC — returns which guest login methods are on
-- ============================================================

CREATE OR REPLACE FUNCTION get_guest_auth_methods()
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT json_build_object(
    'otp_enabled',
    COALESCE((SELECT value = 'true' FROM platform_settings WHERE key = 'guest_otp_enabled'), true),
    'sso_enabled',
    COALESCE((SELECT value = 'true' FROM platform_settings WHERE key = 'guest_sso_enabled'), false)
  );
$$;

GRANT EXECUTE ON FUNCTION get_guest_auth_methods() TO anon, authenticated;

-- ============================================================
-- 5. Partial index for SSO guest email lookup
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_guest_users_sso_email
  ON guest_users(email) WHERE auth_method = 'sso' AND is_active = true;
