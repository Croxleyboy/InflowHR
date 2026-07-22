-- Onboarding table: holds overall employee status and links to other tables
CREATE TABLE IF NOT EXISTS public.onboarding (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_action TEXT NOT NULL DEFAULT 'Joiner', -- Joiner / Leaver
  status TEXT NOT NULL DEFAULT 'new', -- new / Onboarded / updated / Offboarding Approval
  firstname TEXT,
  surname TEXT,
  start_date DATE,
  user_email TEXT,
  device_options JSONB DEFAULT '[]'::jsonb,
  completed_on DATE,
  display_name TEXT,
  user_principal_name TEXT,
  alias_email TEXT,
  job_title TEXT,
  employee_number TEXT,
  department TEXT,
  user_display TEXT,
  mail_nickname TEXT,
  manager TEXT,
  manager_email TEXT,
  asset_enrolled TEXT DEFAULT 'No',
  pc_asset_number TEXT,
  device1 TEXT,
  device2 TEXT,
  device3 TEXT,
  asset_lookup TEXT,
  assigned_assets TEXT,
  updates TEXT,
  notifications TEXT,
  equipment_order TEXT DEFAULT 'N',
  personal_email TEXT,
  win365_reason TEXT,
  is_complete BOOLEAN DEFAULT false,
  admin_user TEXT DEFAULT 'No',
  upn_index TEXT,
  windows_365 BOOLEAN DEFAULT false,
  temporary_password TEXT,
  core_entra_group BOOLEAN DEFAULT true,
  contract_type TEXT DEFAULT 'standard persona', -- Full-time / Permanent / Contract / Guest
  first_day BOOLEAN DEFAULT false,
  first_week BOOLEAN DEFAULT false,
  first_month BOOLEAN DEFAULT false,
  feedback BOOLEAN DEFAULT false,
  three_month BOOLEAN DEFAULT false,
  elearning BOOLEAN DEFAULT false,
  contract_end DATE,
  location TEXT,
  telephone TEXT,
  user_profile_sync BOOLEAN DEFAULT false,
  date_of_birth DATE,
  address_line_1 TEXT,
  address_line_2 TEXT,
  address_line_3 TEXT,
  address_line_4 TEXT,
  emergency_contact_number TEXT,
  gender TEXT,
  nationality TEXT,
  relationship TEXT,
  religion TEXT,
  security_clearance TEXT,
  user_persona TEXT DEFAULT 'standard persona',
  updates_required TEXT DEFAULT 'No',
  allow_overtime BOOLEAN DEFAULT false,
  leave_allowance INTEGER DEFAULT 0,
  mandatory_training_option TEXT DEFAULT 'Postponed', -- Required / Postponed / Not Required
  entra_sync BOOLEAN DEFAULT false,
  employee_id UUID REFERENCES public.employees(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_onboarding" ON public.onboarding FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_onboarding" ON public.onboarding FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_onboarding" ON public.onboarding FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_onboarding" ON public.onboarding FOR DELETE TO anon USING (true);
