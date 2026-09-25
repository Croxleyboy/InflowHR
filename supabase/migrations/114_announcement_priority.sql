-- Add priority column to announcements
ALTER TABLE announcements
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low', 'medium', 'high'));
