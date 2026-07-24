-- Add columns for initial setup screen
ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS next_of_kin_name TEXT;
ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS initial_setup_complete BOOLEAN DEFAULT false;
