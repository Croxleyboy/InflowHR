-- ============================================
-- Expense line items table
-- Run in Supabase SQL Editor
-- ============================================

CREATE TABLE expense_line_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_claim_id BIGINT NOT NULL REFERENCES expense_claims(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  expense_type TEXT NOT NULL,
  description TEXT,
  date_of_purchase DATE NOT NULL DEFAULT CURRENT_DATE,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  mileage_from TEXT,
  mileage_to TEXT,
  total_miles DECIMAL(8,1),
  receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE expense_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can read expense line items (temp)" ON expense_line_items FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert expense line items (temp)" ON expense_line_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update expense line items (temp)" ON expense_line_items FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can delete expense line items (temp)" ON expense_line_items FOR DELETE TO anon USING (true);

-- Also allow anon to delete expense claims (for the delete feature)
CREATE POLICY "Anon can delete expense claims (temp)" ON expense_claims FOR DELETE TO anon USING (true);
