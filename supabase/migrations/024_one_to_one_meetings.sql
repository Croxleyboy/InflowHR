-- 1:1 Meetings table
CREATE TABLE IF NOT EXISTS one_to_one_meetings (
  id SERIAL PRIMARY KEY,
  manager_id UUID NOT NULL REFERENCES employees(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL DEFAULT '10:00',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled')),
  summary TEXT,
  completed_at TIMESTAMPTZ,
  company_id UUID NOT NULL REFERENCES companies(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Meeting comments (employee or manager can add)
CREATE TABLE IF NOT EXISTS one_to_one_comments (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES one_to_one_meetings(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES employees(id),
  body TEXT NOT NULL,
  company_id UUID REFERENCES companies(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_121_manager ON one_to_one_meetings(manager_id);
CREATE INDEX IF NOT EXISTS idx_121_employee ON one_to_one_meetings(employee_id);
CREATE INDEX IF NOT EXISTS idx_121_company ON one_to_one_meetings(company_id);
CREATE INDEX IF NOT EXISTS idx_121_comments_meeting ON one_to_one_comments(meeting_id);

-- RLS
ALTER TABLE one_to_one_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE one_to_one_comments ENABLE ROW LEVEL SECURITY;

-- Meetings: company-scoped policies (no TO clause = applies to all roles including public)
DROP POLICY IF EXISTS "anon_all_121" ON one_to_one_meetings;
DROP POLICY IF EXISTS "auth_all_121" ON one_to_one_meetings;
DROP POLICY IF EXISTS "all_121" ON one_to_one_meetings;
DROP POLICY IF EXISTS "121_company_read" ON one_to_one_meetings;
DROP POLICY IF EXISTS "121_company_insert" ON one_to_one_meetings;
DROP POLICY IF EXISTS "121_company_update" ON one_to_one_meetings;
DROP POLICY IF EXISTS "121_company_delete" ON one_to_one_meetings;

CREATE POLICY "121_company_read" ON one_to_one_meetings FOR SELECT USING (
  company_id = get_my_company_id() OR is_super_admin()
);
CREATE POLICY "121_company_insert" ON one_to_one_meetings FOR INSERT WITH CHECK (
  company_id = get_my_company_id() OR is_super_admin()
);
CREATE POLICY "121_company_update" ON one_to_one_meetings FOR UPDATE USING (
  company_id = get_my_company_id() OR is_super_admin()
);
CREATE POLICY "121_company_delete" ON one_to_one_meetings FOR DELETE USING (
  company_id = get_my_company_id() OR is_super_admin()
);

-- Comments: company-scoped policies
DROP POLICY IF EXISTS "anon_all_121_comments" ON one_to_one_comments;
DROP POLICY IF EXISTS "auth_all_121_comments" ON one_to_one_comments;
DROP POLICY IF EXISTS "all_121_comments" ON one_to_one_comments;
DROP POLICY IF EXISTS "121_comments_read" ON one_to_one_comments;
DROP POLICY IF EXISTS "121_comments_insert" ON one_to_one_comments;
DROP POLICY IF EXISTS "121_comments_update" ON one_to_one_comments;
DROP POLICY IF EXISTS "121_comments_delete" ON one_to_one_comments;

CREATE POLICY "121_comments_read" ON one_to_one_comments FOR SELECT USING (
  company_id = get_my_company_id() OR is_super_admin()
);
CREATE POLICY "121_comments_insert" ON one_to_one_comments FOR INSERT WITH CHECK (
  company_id = get_my_company_id() OR is_super_admin()
);
CREATE POLICY "121_comments_update" ON one_to_one_comments FOR UPDATE USING (
  company_id = get_my_company_id() OR is_super_admin()
);
CREATE POLICY "121_comments_delete" ON one_to_one_comments FOR DELETE USING (
  company_id = get_my_company_id() OR is_super_admin()
);
