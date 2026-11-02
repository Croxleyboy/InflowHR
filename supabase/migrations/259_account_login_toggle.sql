-- Account Login Toggle
-- Adds a super admin platform setting to enable/disable the Account Login tab
-- on the login page (for trial/email-password users). Disabled by default.

INSERT INTO platform_settings (key, value)
VALUES ('account_login_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Extend the existing RPC to also return account_login_enabled
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
    COALESCE((SELECT value = 'true' FROM platform_settings WHERE key = 'guest_sso_enabled'), false),
    'account_login_enabled',
    COALESCE((SELECT value = 'true' FROM platform_settings WHERE key = 'account_login_enabled'), false)
  );
$$;
