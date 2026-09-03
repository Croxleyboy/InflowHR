-- Add lieu_days column to leave_balances
-- Lieu days are manually assigned by admins and add to the employee's available leave balance
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS lieu_days numeric DEFAULT 0 NOT NULL;
