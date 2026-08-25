-- Add timesheet monitoring settings to companies table
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS timesheet_monitoring_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS timesheet_monitoring_period text DEFAULT 'weekly'
    CHECK (timesheet_monitoring_period IN ('weekly', 'monthly'));
