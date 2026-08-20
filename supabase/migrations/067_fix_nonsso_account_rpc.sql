-- Fix create_nonsso_account to also insert auth.identities (required for signInWithPassword)
-- and create an employee record linked to the company_users row
CREATE OR REPLACE FUNCTION public.create_nonsso_account(
  p_email TEXT,
  p_password TEXT,
  p_company_id UUID,
  p_company_name TEXT DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_encrypted_pw text;
  v_employee_id uuid;
  v_cu_id bigint;
BEGIN
  IF NOT is_super_admin() THEN
    RETURN json_build_object('error', 'Only super admins can create non-SSO accounts');
  END IF;

  v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));
  v_user_id := gen_random_uuid();

  -- Insert the auth user
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token,
    email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_user_id,
    'authenticated', 'authenticated', p_email, v_encrypted_pw,
    NOW(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('company_id', p_company_id, 'auth_mode', 'non_sso'),
    NOW(), NOW(), '', '', '', ''
  );

  -- Insert identity record (required for signInWithPassword)
  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_user_id::text, v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', p_email, 'email_verified', true),
    'email', v_user_id::text,
    NOW(), NOW(), NOW()
  );

  -- Create an employee record for the admin
  INSERT INTO employees (
    employee_number, first_name, last_name, email,
    job_title, department, is_admin, is_active,
    company_id, start_date, contract_type, leave_allowance
  ) VALUES (
    'ADMIN-001',
    COALESCE(NULLIF(p_company_name, ''), 'Company'),
    'Admin',
    p_email,
    'Company Administrator',
    'Administration',
    true,
    true,
    p_company_id,
    CURRENT_DATE,
    'Full-time',
    25
  )
  RETURNING id INTO v_employee_id;

  -- Create the company_users row linking auth user + employee to company as admin
  INSERT INTO company_users (auth_user_id, company_id, role, is_active, employee_id)
  VALUES (v_user_id, p_company_id, 'admin', true, v_employee_id)
  RETURNING id INTO v_cu_id;

  -- Store the username on the company record
  UPDATE companies SET nonsso_username = p_email WHERE id = p_company_id;

  RETURN json_build_object('success', true, 'user_id', v_user_id, 'employee_id', v_employee_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_nonsso_account(TEXT, TEXT, UUID, TEXT) TO authenticated;
-- Drop old 3-param signature if it exists
DROP FUNCTION IF EXISTS public.create_nonsso_account(TEXT, TEXT, UUID);
