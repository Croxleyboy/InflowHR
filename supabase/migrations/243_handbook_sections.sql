-- Migration: 243_handbook_sections
-- Description: Handbook policy sections for AI assistant knowledge base.
--   Global rows (company_id IS NULL) hold the master UK handbook.
--   Company-specific rows hold the client's own handbook, built from
--   the questionnaire. Both AI assistants search this table to answer
--   policy questions with real figures and section references.

-- =============================================================================
-- 1. CREATE TABLE
-- =============================================================================

CREATE TABLE handbook_sections (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  section_number TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  handbook_version TEXT DEFAULT '1.0',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', title || ' ' || content)
  ) STORED
);

CREATE INDEX idx_handbook_sections_search ON handbook_sections USING gin(search_vector);
CREATE INDEX idx_handbook_sections_company ON handbook_sections(company_id);
CREATE UNIQUE INDEX idx_handbook_sections_unique ON handbook_sections(company_id, section_key)
  WHERE company_id IS NOT NULL;

-- =============================================================================
-- 2. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE handbook_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY handbook_sections_select ON handbook_sections FOR SELECT
  USING (company_id IS NULL OR company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY handbook_sections_insert ON handbook_sections FOR INSERT
  WITH CHECK (is_super_admin() OR (company_id = get_my_company_id() AND is_company_admin()));

CREATE POLICY handbook_sections_update ON handbook_sections FOR UPDATE
  USING (is_super_admin() OR (company_id = get_my_company_id() AND is_company_admin()))
  WITH CHECK (is_super_admin() OR (company_id = get_my_company_id() AND is_company_admin()));

CREATE POLICY handbook_sections_delete ON handbook_sections FOR DELETE
  USING (is_super_admin() OR (company_id = get_my_company_id() AND is_company_admin()));
