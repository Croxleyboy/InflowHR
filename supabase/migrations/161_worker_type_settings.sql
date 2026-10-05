-- Worker type payroll settings: company-wide defaults per worker type
CREATE TABLE IF NOT EXISTS worker_type_settings (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_type TEXT NOT NULL CHECK (worker_type IN ('employed', 'shift_worker', 'zero_hours')),
  pay_pattern TEXT NOT NULL DEFAULT 'monthly' CHECK (pay_pattern IN ('weekly', 'bi_weekly', 'monthly')),
  overtime_handling TEXT NOT NULL DEFAULT 'none' CHECK (overtime_handling IN ('overtime', 'toil', 'none')),
  time_recording TEXT NOT NULL DEFAULT 'checkin' CHECK (time_recording IN ('timesheet', 'checkin')),
  overtime_rate_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.50,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE(company_id, worker_type)
);

ALTER TABLE worker_type_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "worker_type_settings_select" ON worker_type_settings
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND is_active = true)
  );

CREATE POLICY "worker_type_settings_admin" ON worker_type_settings
  FOR ALL USING (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'hr') AND is_active = true)
  );

-- Per-employee override columns
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pay_pattern_override TEXT CHECK (pay_pattern_override IS NULL OR pay_pattern_override IN ('weekly', 'bi_weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS overtime_handling_override TEXT CHECK (overtime_handling_override IS NULL OR overtime_handling_override IN ('overtime', 'toil', 'none')),
  ADD COLUMN IF NOT EXISTS time_recording_override TEXT CHECK (time_recording_override IS NULL OR time_recording_override IN ('timesheet', 'checkin')),
  ADD COLUMN IF NOT EXISTS is_payroll_exception BOOLEAN DEFAULT false;

-- Change log for when company defaults change and employees are exceptions
CREATE TABLE IF NOT EXISTS worker_setting_change_log (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES auth.users(id),
  worker_type TEXT NOT NULL,
  setting_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  exception_employee_ids UUID[] DEFAULT '{}',
  exception_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE worker_setting_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "worker_setting_change_log_select" ON worker_setting_change_log
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'hr') AND is_active = true)
  );

CREATE POLICY "worker_setting_change_log_insert" ON worker_setting_change_log
  FOR INSERT WITH CHECK (
    company_id IN (SELECT company_id FROM company_users WHERE auth_user_id = auth.uid() AND role IN ('admin', 'hr') AND is_active = true)
  );
