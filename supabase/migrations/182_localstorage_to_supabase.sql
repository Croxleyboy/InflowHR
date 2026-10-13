-- ══════════════════════════════════════════════════════════════════
-- 182: Migrate localStorage data to Supabase
-- ══════════════════════════════════════════════════════════════════

-- ── 1. User preferences (theme, dashboard layout, kudos settings) ──

CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  theme text CHECK (theme IN ('light', 'dark')),
  dashboard_layout text DEFAULT 'detailed' CHECK (dashboard_layout IN ('cards', 'detailed')),
  dashboard_mode text DEFAULT 'simple' CHECK (dashboard_mode IN ('simple', 'plain', 'info')),
  info_card_order text[],
  info_card_hidden text[],
  dd2_columns jsonb,
  dd2_hero_img smallint DEFAULT 0,
  dd2_hide_pay boolean DEFAULT false,
  kudos_watchlist uuid[],
  kudos_colleagues_only boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (company_id, employee_id)
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_prefs_select" ON user_preferences FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "user_prefs_insert" ON user_preferences FOR INSERT
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "user_prefs_update" ON user_preferences FOR UPDATE
  USING (company_id = get_my_company_id());
CREATE POLICY "user_prefs_delete" ON user_preferences FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE INDEX idx_user_prefs_company ON user_preferences(company_id);
CREATE INDEX idx_user_prefs_employee ON user_preferences(employee_id);

REVOKE ALL ON user_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_preferences TO authenticated;


-- ── 2. Legal timesheet timers (active running timers) ──

CREATE TABLE IF NOT EXISTS legal_timesheet_timers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  client_name text NOT NULL,
  matter_id uuid NOT NULL,
  matter_name text NOT NULL,
  task_code text DEFAULT 'L110',
  elapsed_seconds integer NOT NULL DEFAULT 0,
  is_running boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE legal_timesheet_timers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lt_timers_select" ON legal_timesheet_timers FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "lt_timers_insert" ON legal_timesheet_timers FOR INSERT
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "lt_timers_update" ON legal_timesheet_timers FOR UPDATE
  USING (company_id = get_my_company_id());
CREATE POLICY "lt_timers_delete" ON legal_timesheet_timers FOR DELETE
  USING (company_id = get_my_company_id());

CREATE INDEX idx_lt_timers_company ON legal_timesheet_timers(company_id);
CREATE INDEX idx_lt_timers_employee ON legal_timesheet_timers(employee_id);

REVOKE ALL ON legal_timesheet_timers FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON legal_timesheet_timers TO authenticated;


-- ── 3. E-learning: add bookmarked + progress columns to elearning_completions ──
-- Existing table only tracks completions. Add bookmarks and progress separately.

CREATE TABLE IF NOT EXISTS elearning_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES elearning_courses(id) ON DELETE CASCADE,
  is_bookmarked boolean NOT NULL DEFAULT false,
  progress_pct integer NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (company_id, employee_id, course_id)
);

ALTER TABLE elearning_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "el_progress_select" ON elearning_progress FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "el_progress_insert" ON elearning_progress FOR INSERT
  WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "el_progress_update" ON elearning_progress FOR UPDATE
  USING (company_id = get_my_company_id());
CREATE POLICY "el_progress_delete" ON elearning_progress FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE INDEX idx_el_progress_company ON elearning_progress(company_id);
CREATE INDEX idx_el_progress_employee ON elearning_progress(employee_id);

REVOKE ALL ON elearning_progress FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON elearning_progress TO authenticated;


-- ── 4. Add theme column to company_users for per-user theme preference ──

ALTER TABLE company_users ADD COLUMN IF NOT EXISTS theme text CHECK (theme IN ('light', 'dark'));
