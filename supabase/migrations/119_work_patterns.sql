-- Work Patterns: company-defined day-of-week schedules assigned to employees
CREATE TABLE IF NOT EXISTS work_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  days BOOLEAN[] NOT NULL DEFAULT '{true,true,true,true,true,false,false}',
  pattern_type TEXT NOT NULL DEFAULT 'fixed',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, name)
);

COMMENT ON COLUMN work_patterns.days IS 'Boolean array [Mon,Tue,Wed,Thu,Fri,Sat,Sun] — true = contracted working day';
COMMENT ON COLUMN work_patterns.pattern_type IS 'fixed = set days each week, variable = any day (no restrictions)';

ALTER TABLE work_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_patterns_select" ON work_patterns FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "work_patterns_insert" ON work_patterns FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "work_patterns_update" ON work_patterns FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "work_patterns_delete" ON work_patterns FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

-- Add FK on employees pointing to a work pattern
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_pattern_id UUID REFERENCES work_patterns(id) ON DELETE SET NULL;

-- Same on onboarding so CSV bulk import can reference it
ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS work_pattern_id UUID REFERENCES work_patterns(id) ON DELETE SET NULL;

-- Seed default patterns for every existing company
INSERT INTO work_patterns (company_id, name, days, pattern_type)
SELECT c.id, 'Standard (Mon–Fri)', '{true,true,true,true,true,false,false}', 'fixed'
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM work_patterns wp WHERE wp.company_id = c.id AND wp.name = 'Standard (Mon–Fri)')
ON CONFLICT DO NOTHING;

INSERT INTO work_patterns (company_id, name, days, pattern_type)
SELECT c.id, 'Weekend (Sat–Sun)', '{false,false,false,false,false,true,true}', 'fixed'
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM work_patterns wp WHERE wp.company_id = c.id AND wp.name = 'Weekend (Sat–Sun)')
ON CONFLICT DO NOTHING;

INSERT INTO work_patterns (company_id, name, days, pattern_type)
SELECT c.id, 'Variable', '{true,true,true,true,true,true,true}', 'variable'
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM work_patterns wp WHERE wp.company_id = c.id AND wp.name = 'Variable')
ON CONFLICT DO NOTHING;
