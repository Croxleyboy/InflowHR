-- 013: Extend kudos table for broadcasts, likes, badges, qualities, recognition types

-- Allow category to accept new recognition types
ALTER TABLE kudos DROP CONSTRAINT IF EXISTS kudos_category_check;

-- Add new columns
ALTER TABLE kudos ADD COLUMN IF NOT EXISTS recognition_type TEXT DEFAULT 'recognition';
ALTER TABLE kudos ADD COLUMN IF NOT EXISTS badge TEXT;
ALTER TABLE kudos ADD COLUMN IF NOT EXISTS quality TEXT;
ALTER TABLE kudos ADD COLUMN IF NOT EXISTS is_broadcast BOOLEAN DEFAULT FALSE;
ALTER TABLE kudos ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
ALTER TABLE kudos ADD COLUMN IF NOT EXISTS liked_by UUID[] DEFAULT '{}';

-- Make to_employee_id nullable for broadcasts
ALTER TABLE kudos ALTER COLUMN to_employee_id DROP NOT NULL;

-- Allow anon access for dev
CREATE POLICY "anon_read_kudos" ON kudos FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_kudos" ON kudos FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_kudos" ON kudos FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_kudos" ON kudos FOR DELETE TO anon USING (true);

-- Seed some broadcast and enhanced kudos
INSERT INTO kudos (from_employee_id, to_employee_id, message, category, recognition_type, badge, quality, is_broadcast, is_public, like_count, created_at)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', NULL,
   'Huge congratulations to the whole team for hitting our Q2 targets! Your dedication and hard work made this possible.',
   'teamwork', 'broadcast', NULL, NULL, TRUE, TRUE, 5, '2026-07-18'),
  ('b2c3d4e5-f6a7-8901-bcde-f12345678901', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'Andy, your leadership on the product launch was outstanding. You kept everyone motivated and focused.',
   'leadership', 'recognition', 'above_and_beyond', 'great_leader', FALSE, TRUE, 3, '2026-07-15'),
  ('c3d4e5f6-a7b8-9012-cdef-123456789012', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
   'Thank you for mentoring me through my first month. Your patience and guidance meant the world.',
   'going_above', 'thank_you', 'mentor', 'great_mentor', FALSE, TRUE, 2, '2026-07-12'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', NULL,
   'Welcome aboard Henry Smith! We are thrilled to have you join the team. Wishing you a fantastic start!',
   'teamwork', 'welcome', NULL, NULL, TRUE, TRUE, 8, '2026-07-08');
