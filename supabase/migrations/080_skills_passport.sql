-- ============================================================================
-- 080 — Skills Passport & Talent Intelligence
-- Tables, RLS, indexes, default seed data, subscription pricing
-- ============================================================================

-- ─── SKILL CATEGORIES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  is_system     boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE skill_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON skill_categories FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Company scoped insert" ON skill_categories FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Company scoped update" ON skill_categories FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Company scoped delete" ON skill_categories FOR DELETE USING (can_access_company(company_id));

-- ─── SKILLS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id   uuid NOT NULL REFERENCES skill_categories(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  is_system     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, category_id, name)
);

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON skills FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Company scoped insert" ON skills FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Company scoped update" ON skills FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Company scoped delete" ON skills FOR DELETE USING (can_access_company(company_id));

CREATE INDEX idx_skills_company_category ON skills (company_id, category_id);

-- ─── EMPLOYEE SKILLS ────────────────────────────────────────────────────────
-- proficiency: 1=Foundational, 2=Developing, 3=Proficient, 4=Advanced, 5=Expert
-- status: pending_validation, validated, rejected, self_declared
CREATE TABLE IF NOT EXISTS employee_skills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_id        uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  proficiency     int NOT NULL CHECK (proficiency BETWEEN 1 AND 5),
  status          text NOT NULL DEFAULT 'self_declared' CHECK (status IN ('pending_validation','validated','rejected','self_declared')),
  validated_by    uuid REFERENCES employees(id) ON DELETE SET NULL,
  validated_at    timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, skill_id)
);

ALTER TABLE employee_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON employee_skills FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Company scoped insert" ON employee_skills FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Company scoped update" ON employee_skills FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Company scoped delete" ON employee_skills FOR DELETE USING (can_access_company(company_id));

CREATE INDEX idx_employee_skills_emp   ON employee_skills (employee_id);
CREATE INDEX idx_employee_skills_skill ON employee_skills (skill_id);

-- ─── SKILL EVIDENCE ─────────────────────────────────────────────────────────
-- evidence_type: certificate, course_completion, project, peer_endorsement, manager_observation, other
CREATE TABLE IF NOT EXISTS skill_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_skill_id uuid NOT NULL REFERENCES employee_skills(id) ON DELETE CASCADE,
  evidence_type     text NOT NULL CHECK (evidence_type IN ('certificate','course_completion','project','peer_endorsement','manager_observation','other')),
  title             text NOT NULL,
  description       text,
  file_url          text,
  awarded_date      date,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE skill_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON skill_evidence FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Company scoped insert" ON skill_evidence FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Company scoped update" ON skill_evidence FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Company scoped delete" ON skill_evidence FOR DELETE USING (can_access_company(company_id));

-- ─── EMPLOYEE CERTIFICATIONS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_certifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name            text NOT NULL,
  issuing_body    text NOT NULL,
  issue_date      date NOT NULL,
  expiry_date     date,
  credential_id   text,
  credential_url  text,
  file_url        text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON employee_certifications FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Company scoped insert" ON employee_certifications FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Company scoped update" ON employee_certifications FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Company scoped delete" ON employee_certifications FOR DELETE USING (can_access_company(company_id));

CREATE INDEX idx_certs_employee ON employee_certifications (employee_id);

-- ─── EMPLOYEE CAREER ASPIRATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_career_aspirations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  target_role       text,
  target_department text,
  timeframe         text CHECK (timeframe IN ('6_months','1_year','2_years','3_plus_years')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id)
);

ALTER TABLE employee_career_aspirations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON employee_career_aspirations FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Company scoped insert" ON employee_career_aspirations FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Company scoped update" ON employee_career_aspirations FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Company scoped delete" ON employee_career_aspirations FOR DELETE USING (can_access_company(company_id));

-- ─── ROLE PROFILES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title         text NOT NULL,
  department    text,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, title)
);

ALTER TABLE role_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON role_profiles FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Company scoped insert" ON role_profiles FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Company scoped update" ON role_profiles FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Company scoped delete" ON role_profiles FOR DELETE USING (can_access_company(company_id));

-- ─── ROLE SKILL REQUIREMENTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_skill_requirements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_profile_id   uuid NOT NULL REFERENCES role_profiles(id) ON DELETE CASCADE,
  skill_id          uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  min_proficiency   int NOT NULL DEFAULT 3 CHECK (min_proficiency BETWEEN 1 AND 5),
  is_essential      boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_profile_id, skill_id)
);

ALTER TABLE role_skill_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON role_skill_requirements FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Company scoped insert" ON role_skill_requirements FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Company scoped update" ON role_skill_requirements FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Company scoped delete" ON role_skill_requirements FOR DELETE USING (can_access_company(company_id));

CREATE INDEX idx_role_reqs_profile ON role_skill_requirements (role_profile_id);

-- ─── SKILL VALIDATION REQUESTS (workflow) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_validations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_skill_id uuid NOT NULL REFERENCES employee_skills(id) ON DELETE CASCADE,
  requested_by    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_to     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  response_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz
);

ALTER TABLE skill_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company scoped read"   ON skill_validations FOR SELECT USING (can_access_company(company_id));
CREATE POLICY "Company scoped insert" ON skill_validations FOR INSERT WITH CHECK (can_access_company(company_id));
CREATE POLICY "Company scoped update" ON skill_validations FOR UPDATE USING (can_access_company(company_id));
CREATE POLICY "Company scoped delete" ON skill_validations FOR DELETE USING (can_access_company(company_id));

CREATE INDEX idx_skill_validations_assigned ON skill_validations (assigned_to, status);

-- ─── SUBSCRIPTION PRICING ───────────────────────────────────────────────────
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
VALUES ('skills_passport', 'Skills Passport & Talent Intelligence', 'Employee skills tracking, certifications, career aspirations, role matching and workforce analytics', 1.00, true, true)
ON CONFLICT (feature_key) DO NOTHING;
