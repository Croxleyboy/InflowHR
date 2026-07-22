-- Add avatar_url to onboarding table for directory photos
ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Add appstatus to control visibility in HR app directory
ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS appstatus TEXT DEFAULT 'inactive';

-- Set existing onboarded records to active so they remain visible
UPDATE onboarding SET appstatus = 'active' WHERE status IN ('Onboarded', 'updated');
