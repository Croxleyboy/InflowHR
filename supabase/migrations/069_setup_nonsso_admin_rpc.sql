-- New RPC: sets up employee + company_users for a non-SSO admin user
-- Auth user creation is now handled by Supabase's signUp API (not raw INSERT)
CREATE OR REPLACE FUNCTION public.setup_nonsso_admin(
  p_user_id UUID,
  p_email TEXT,
  p_company_id UUID,
  p_company_name TEXT DEFAULT ''
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_cu_id uuid;
BEGIN
  IF NOT is_super_admin() THEN
    RETURN json_build_object('error', 'Only super admins can setup non-SSO admins');
  END IF;

  -- Auto-confirm the user's email (signUp may leave it unconfirmed)
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
  WHERE id = p_user_id;

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
    true, true,
    p_company_id,
    CURRENT_DATE,
    'Full-time',
    25
  )
  RETURNING id INTO v_employee_id;

  INSERT INTO company_users (auth_user_id, company_id, role, is_active, employee_id)
  VALUES (p_user_id, p_company_id, 'admin', true, v_employee_id)
  RETURNING id INTO v_cu_id;

  UPDATE companies SET nonsso_username = p_email WHERE id = p_company_id;

  RETURN json_build_object('success', true, 'user_id', p_user_id, 'employee_id', v_employee_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.setup_nonsso_admin(UUID, TEXT, UUID, TEXT) TO authenticated;
