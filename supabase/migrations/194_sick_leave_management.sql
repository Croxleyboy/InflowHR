-- 194_sick_leave_management.sql
-- UK-compliant sickness absence management: uncapped sick leave with CSP/SSP pay phases,
-- Bradford Factor monitoring, fit note tracking, and manual pay status workflow.

-- 1. Company-level sick pay policy settings
CREATE TABLE IF NOT EXISTS sick_pay_settings (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT false,
  csp_full_pay_days INTEGER DEFAULT 10 CHECK (csp_full_pay_days >= 0),
  csp_half_pay_days INTEGER DEFAULT 10 CHECK (csp_half_pay_days >= 0),
  ssp_weekly_rate NUMERIC(8,2) DEFAULT 123.25,
  ssp_max_weeks INTEGER DEFAULT 28,
  bradford_green_threshold INTEGER DEFAULT 50,
  bradford_amber_threshold INTEGER DEFAULT 200,
  absence_trigger_spells INTEGER DEFAULT 3,
  absence_trigger_months INTEGER DEFAULT 6,
  fit_note_days_threshold INTEGER DEFAULT 7,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id)
);

ALTER TABLE sick_pay_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sick_pay_settings_select" ON sick_pay_settings FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "sick_pay_settings_insert" ON sick_pay_settings FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "sick_pay_settings_update" ON sick_pay_settings FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "sick_pay_settings_delete" ON sick_pay_settings FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

-- 2. Sick leave episodes (groups consecutive sick requests into spells for Bradford Factor)
CREATE TABLE IF NOT EXISTS sick_leave_episodes (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  episode_start DATE NOT NULL,
  episode_end DATE,
  calendar_days INTEGER DEFAULT 0,
  working_days_lost INTEGER DEFAULT 0,
  is_open BOOLEAN DEFAULT true,
  fit_note_required BOOLEAN DEFAULT false,
  fit_note_received BOOLEAN DEFAULT false,
  fit_note_expiry DATE,
  return_to_work_completed BOOLEAN DEFAULT false,
  return_to_work_date DATE,
  return_to_work_notes TEXT,
  csp_days_used INTEGER DEFAULT 0,
  ssp_weeks_used NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sick_leave_episodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sick_leave_episodes_select" ON sick_leave_episodes FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "sick_leave_episodes_insert" ON sick_leave_episodes FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "sick_leave_episodes_update" ON sick_leave_episodes FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "sick_leave_episodes_delete" ON sick_leave_episodes FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

-- 3. Junction table linking leave requests to episodes
CREATE TABLE IF NOT EXISTS sick_leave_episode_requests (
  episode_id INTEGER NOT NULL REFERENCES sick_leave_episodes(id) ON DELETE CASCADE,
  leave_request_id BIGINT NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  PRIMARY KEY (episode_id, leave_request_id)
);

ALTER TABLE sick_leave_episode_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sick_episode_requests_select" ON sick_leave_episode_requests FOR SELECT
  USING (EXISTS (SELECT 1 FROM sick_leave_episodes e WHERE e.id = episode_id AND (e.company_id = get_my_company_id() OR is_super_admin())));
CREATE POLICY "sick_episode_requests_insert" ON sick_leave_episode_requests FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM sick_leave_episodes e WHERE e.id = episode_id AND (e.company_id = get_my_company_id() OR is_super_admin())));
CREATE POLICY "sick_episode_requests_delete" ON sick_leave_episode_requests FOR DELETE
  USING (EXISTS (SELECT 1 FROM sick_leave_episodes e WHERE e.id = episode_id AND (e.company_id = get_my_company_id() OR is_super_admin())));

-- 4. Employee-level sick pay status flag (admin manually sets this)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sick_pay_status TEXT DEFAULT 'normal'
  CHECK (sick_pay_status IN ('normal', 'csp_full', 'csp_half', 'ssp', 'unpaid'));

-- 5. Payslip columns for sick pay
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS sick_pay NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS sick_pay_type TEXT
  CHECK (sick_pay_type IN ('csp_full', 'csp_half', 'ssp', 'unpaid'));
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS sick_days_in_period NUMERIC(5,1) DEFAULT 0;

-- 6. Remove sick leave from leave_balances (no cap on sick leave)
DELETE FROM leave_balances
WHERE leave_type_id IN (
  SELECT id FROM leave_types WHERE LOWER(name) = 'sick leave'
);

-- 7. Bradford Factor calculation function
CREATE OR REPLACE FUNCTION calc_bradford_factor(
  p_employee_id UUID,
  p_company_id UUID,
  p_from DATE,
  p_to DATE
) RETURNS INTEGER AS $$
DECLARE
  v_spells INTEGER;
  v_days INTEGER;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(working_days_lost), 0)
  INTO v_spells, v_days
  FROM sick_leave_episodes
  WHERE employee_id = p_employee_id
    AND company_id = p_company_id
    AND episode_start >= p_from
    AND episode_start <= p_to;

  RETURN (v_spells * v_spells * v_days);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
