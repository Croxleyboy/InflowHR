-- ============================================
-- Add start_date, end_date, cost_center to expense_claims
-- Run in Supabase SQL Editor
-- ============================================

ALTER TABLE expense_claims ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE expense_claims ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE expense_claims ADD COLUMN IF NOT EXISTS cost_center TEXT DEFAULT 'External expenses';

-- Temporary anon insert/update policy (remove once Entra SSO is live)
CREATE POLICY "Anon can insert expense claims (temp)" ON expense_claims FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update expense claims (temp)" ON expense_claims FOR UPDATE TO anon USING (true);
