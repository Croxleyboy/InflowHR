-- 146: Modulr integration + BACS export support
-- Adds modulr_integrations table with encrypted credential storage,
-- modulr_payments audit trail, and company BACS originator fields.

-- ═══════════════════════════════════════════════════════════════
-- 1. Modulr integrations table (one per company)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE modulr_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  api_key_encrypted         text NOT NULL,
  hmac_secret_encrypted     text NOT NULL,
  source_account_id         text NOT NULL,
  encryption_iv             text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'connected', 'ip_whitelist_pending', 'error')),
  status_error    text,
  connected_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modulr_integrations_company_unique UNIQUE (company_id)
);

ALTER TABLE modulr_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company modulr integration"
  ON modulr_integrations FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Admins can insert modulr integration"
  ON modulr_integrations FOR INSERT
  WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.auth_user_id = auth.uid()
        AND company_users.company_id = modulr_integrations.company_id
        AND company_users.role IN ('admin', 'hr')
        AND company_users.is_active = true
    )
  );

CREATE POLICY "Admins can update modulr integration"
  ON modulr_integrations FOR UPDATE
  USING (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.auth_user_id = auth.uid()
        AND company_users.company_id = modulr_integrations.company_id
        AND company_users.role IN ('admin', 'hr')
        AND company_users.is_active = true
    )
  );

CREATE POLICY "Admins can delete modulr integration"
  ON modulr_integrations FOR DELETE
  USING (
    company_id = get_my_company_id()
    AND EXISTS (
      SELECT 1 FROM company_users
      WHERE company_users.auth_user_id = auth.uid()
        AND company_users.company_id = modulr_integrations.company_id
        AND company_users.role IN ('admin', 'hr')
        AND company_users.is_active = true
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 2. Modulr payments audit trail
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE modulr_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payrun_ref      text NOT NULL,
  total_amount    decimal(12,2) NOT NULL,
  employee_count  integer NOT NULL,
  modulr_batch_id text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'submitted', 'approved', 'completed', 'failed', 'cancelled')),
  status_detail   text,
  submitted_by    uuid REFERENCES auth.users(id),
  submitted_at    timestamptz DEFAULT now(),
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE modulr_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company modulr payments"
  ON modulr_payments FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Service role can insert modulr payments"
  ON modulr_payments FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Service role can update modulr payments"
  ON modulr_payments FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());

-- ═══════════════════════════════════════════════════════════════
-- 3. Modulr payment line items
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE modulr_payment_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES modulr_payments(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount          decimal(10,2) NOT NULL,
  sort_code       text,
  account_number  text,
  reference       text,
  modulr_payment_id text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'submitted', 'completed', 'failed')),
  error_detail    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE modulr_payment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company modulr payment items"
  ON modulr_payment_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM modulr_payments mp
      WHERE mp.id = modulr_payment_items.payment_id
        AND (mp.company_id = get_my_company_id() OR is_super_admin())
    )
  );

CREATE POLICY "Service role can insert modulr payment items"
  ON modulr_payment_items FOR INSERT
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- 4. Company BACS originator fields
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS bacs_originator_sort_code   text,
  ADD COLUMN IF NOT EXISTS bacs_originator_account_no  text,
  ADD COLUMN IF NOT EXISTS bacs_originator_name        text;

-- ═══════════════════════════════════════════════════════════════
-- 5. Feature flag
-- ═══════════════════════════════════════════════════════════════

-- modulr_integration feature is a standard feature (free, off by default)
-- It will be added to FeatureContext in the frontend code.
