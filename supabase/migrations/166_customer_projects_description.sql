-- 166: Add description column to customer_projects
ALTER TABLE customer_projects ADD COLUMN IF NOT EXISTS description TEXT;
