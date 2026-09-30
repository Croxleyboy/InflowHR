-- Add shift_contract_type to rotas and shift_templates
-- Links rotas and templates to a specific shift worker contract type
ALTER TABLE rotas
  ADD COLUMN IF NOT EXISTS shift_contract_type TEXT;

ALTER TABLE shift_templates
  ADD COLUMN IF NOT EXISTS shift_contract_type TEXT;
