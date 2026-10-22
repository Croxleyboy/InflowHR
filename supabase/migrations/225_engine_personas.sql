-- Engine-owned personas: migrate InflowHR persona keys to engine ids,
-- drop the persona mappings table, relax CHECK constraints.

-- 1. Migrate employees.persona from InflowHR keys to engine ids
UPDATE employees SET persona = 'information-worker' WHERE persona = 'standard';
UPDATE employees SET persona = 'mobile-field-worker' WHERE persona = 'mobile';
UPDATE employees SET persona = 'secure-vip' WHERE persona = 'strict_secure';
UPDATE employees SET persona = 'shared-kiosk' WHERE persona = 'kiosk';

-- 2. Drop the CHECK constraint on employees.persona (engine ids are free-form text)
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_persona_check;

-- 3. Migrate persona values inside role_changes.changes JSONB
UPDATE role_changes SET changes = jsonb_set(changes, '{persona,old}', '"information-worker"')
  WHERE changes->'persona'->>'old' = 'standard';
UPDATE role_changes SET changes = jsonb_set(changes, '{persona,new}', '"information-worker"')
  WHERE changes->'persona'->>'new' = 'standard';
UPDATE role_changes SET changes = jsonb_set(changes, '{persona,old}', '"mobile-field-worker"')
  WHERE changes->'persona'->>'old' = 'mobile';
UPDATE role_changes SET changes = jsonb_set(changes, '{persona,new}', '"mobile-field-worker"')
  WHERE changes->'persona'->>'new' = 'mobile';
UPDATE role_changes SET changes = jsonb_set(changes, '{persona,old}', '"secure-vip"')
  WHERE changes->'persona'->>'old' = 'strict_secure';
UPDATE role_changes SET changes = jsonb_set(changes, '{persona,new}', '"secure-vip"')
  WHERE changes->'persona'->>'new' = 'strict_secure';
UPDATE role_changes SET changes = jsonb_set(changes, '{persona,old}', '"shared-kiosk"')
  WHERE changes->'persona'->>'old' = 'kiosk';
UPDATE role_changes SET changes = jsonb_set(changes, '{persona,new}', '"shared-kiosk"')
  WHERE changes->'persona'->>'new' = 'kiosk';

-- 4. Drop the persona mappings table (engine owns persona config now)
DROP TABLE IF EXISTS inflowonboarder_persona_mappings;

-- 5. Update default on employees.persona to engine id
ALTER TABLE employees ALTER COLUMN persona SET DEFAULT 'information-worker';
