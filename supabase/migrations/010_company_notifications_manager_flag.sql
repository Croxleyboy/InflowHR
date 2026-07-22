-- Add manager flag for posting company notifications
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS can_post_notifications BOOLEAN NOT NULL DEFAULT FALSE;

-- Set Andy Jones as able to post
UPDATE employees SET can_post_notifications = TRUE
  WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

-- Add submitted_by_name to announcements for display
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS submitted_by_name TEXT;

-- Allow anon to insert announcements (manager check done in app)
DROP POLICY IF EXISTS "anon_insert_announcements" ON announcements;
CREATE POLICY "anon_insert_announcements" ON announcements
  FOR INSERT TO anon WITH CHECK (true);

-- Allow anon to read announcements (already exists but ensure)
DROP POLICY IF EXISTS "anon_read_announcements" ON announcements;
CREATE POLICY "anon_read_announcements" ON announcements
  FOR SELECT TO anon USING (true);

-- Seed a sample company notification
INSERT INTO announcements (title, body, author_id, submitted_by_name, is_pinned, published_at)
VALUES (
  'Latest Company Update!',
  'InflowHR now provides a new language deployment, German. Enjoy',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Andy Jones',
  false,
  NOW()
);
