-- RPC to create a non-SSO auth account from the admin UI
-- Uses SECURITY DEFINER to insert directly into auth.users
-- Only callable by super admins
CREATE OR REPLACE FUNCTION public.create_nonsso_account(
  p_email TEXT,
  p_password TEXT,
  p_company_id UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_encrypted_pw text;
BEGIN
  IF NOT is_super_admin() THEN
    RETURN json_build_object('error', 'Only super admins can create non-SSO accounts');
  END IF;

  -- Hash the password using bcrypt via pgcrypto
  v_encrypted_pw := crypt(p_password, gen_salt('bf'));

  -- Insert the auth user
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    p_email,
    v_encrypted_pw,
    NOW(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('company_id', p_company_id, 'auth_mode', 'non_sso'),
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  )
  RETURNING id INTO v_user_id;

  -- Create the company_users row linking the auth user to the company as admin
  INSERT INTO company_users (auth_user_id, company_id, role, is_active)
  VALUES (v_user_id, p_company_id, 'admin', true);

  -- Store the username on the company record
  UPDATE companies
  SET nonsso_username = p_email
  WHERE id = p_company_id;

  RETURN json_build_object('success', true, 'user_id', v_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_nonsso_account(TEXT, TEXT, UUID) TO authenticated;
