-- Add employment_category to employees
-- Values: 'not_assigned', 'employed', 'shift_worker', 'contractor'
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employment_category TEXT NOT NULL DEFAULT 'not_assigned';
