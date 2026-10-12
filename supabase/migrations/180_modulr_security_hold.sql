-- 180: Modulr security hardening + payment hold support
-- Tightens RLS, masks bank PII, adds hold flag, prevents duplicate payments.

-- ═══════════════════════════════════════════════════════════════
-- 1. Add hold flag to modulr_payment_items
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE modulr_payment_items
  ADD COLUMN IF NOT EXISTS modulr_hold BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════
-- 2. Mask bank details — keep only last 4 digits
--    (new items will be masked at insert time by edge function;
--     existing items are masked here)
-- ═══════════════════════════════════════════════════════════════

UPDATE modulr_payment_items
SET sort_code = CASE
      WHEN sort_code IS NOT NULL AND length(sort_code) >= 4
      THEN '**' || right(sort_code, 4)
      ELSE sort_code
    END,
    account_number = CASE
      WHEN account_number IS NOT NULL AND length(account_number) >= 4
      THEN '****' || right(account_number, 4)
      ELSE account_number
    END;

-- ═══════════════════════════════════════════════════════════════
-- 3. Tighten modulr_payment_items RLS policies
-- ═══════════════════════════════════════════════════════════════

-- Remove the open INSERT policy
DROP POLICY IF EXISTS "Service role can insert modulr payment items" ON modulr_payment_items;

-- Restrict INSERT to company admins (edge function uses service role which bypasses RLS,
-- but this prevents any direct client-side insertion)
CREATE POLICY "Company admin can insert modulr payment items" ON modulr_payment_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM modulr_payments mp
      JOIN company_users cu ON cu.company_id = mp.company_id
      WHERE mp.id = modulr_payment_items.payment_id
        AND cu.auth_user_id = auth.uid()
        AND cu.role IN ('admin', 'hr')
        AND cu.is_active = true
    )
    OR is_super_admin()
  );

-- Add UPDATE policy for hold toggling (company admin only)
DROP POLICY IF EXISTS "Company admin can update modulr payment items" ON modulr_payment_items;
CREATE POLICY "Company admin can update modulr payment items" ON modulr_payment_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM modulr_payments mp
      JOIN company_users cu ON cu.company_id = mp.company_id
      WHERE mp.id = modulr_payment_items.payment_id
        AND cu.auth_user_id = auth.uid()
        AND cu.role IN ('admin', 'hr')
        AND cu.is_active = true
    )
    OR is_super_admin()
  );

-- Add DELETE policy (company admin only)
DROP POLICY IF EXISTS "Company admin can delete modulr payment items" ON modulr_payment_items;
CREATE POLICY "Company admin can delete modulr payment items" ON modulr_payment_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM modulr_payments mp
      JOIN company_users cu ON cu.company_id = mp.company_id
      WHERE mp.id = modulr_payment_items.payment_id
        AND cu.auth_user_id = auth.uid()
        AND cu.role IN ('admin', 'hr')
        AND cu.is_active = true
    )
    OR is_super_admin()
  );

-- ═══════════════════════════════════════════════════════════════
-- 4. Prevent duplicate payments at DB level
--    Same employee cannot appear twice in the same batch
--    (cross-batch duplicates are prevented by the edge function
--     checking modulr_payment_items before inserting)
-- ═══════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_modulr_payment_items_no_duplicate
  ON modulr_payment_items (employee_id, payment_id)
  WHERE status NOT IN ('failed');
