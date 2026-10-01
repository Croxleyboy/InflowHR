-- Migration 149: Legal invoicing — charge-out rates, company billing details, invoice tables
-- Supports PDF invoice generation and Sage/Xero CSV export

-- ── Company billing details ─────────────────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS company_registration_number text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS billing_address_line1 text,
  ADD COLUMN IF NOT EXISTS billing_address_line2 text,
  ADD COLUMN IF NOT EXISTS billing_city text,
  ADD COLUMN IF NOT EXISTS billing_county text,
  ADD COLUMN IF NOT EXISTS billing_postcode text,
  ADD COLUMN IF NOT EXISTS billing_country text DEFAULT 'United Kingdom',
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS billing_phone text;

-- ── Employee charge-out rate (separate from hourly_rate which is pay rate) ──
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS charge_out_rate numeric(10,2);

COMMENT ON COLUMN employees.charge_out_rate IS 'Client billing rate per hour — separate from hourly_rate (pay rate)';

-- ── Client billing details ──────────────────────────────────────────────────
ALTER TABLE legal_clients
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS county text,
  ADD COLUMN IF NOT EXISTS postcode text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'United Kingdom',
  ADD COLUMN IF NOT EXISTS payment_terms_days integer DEFAULT 30;

-- ── Legal invoices ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES legal_clients(id) ON DELETE CASCADE,
  invoice_number    text NOT NULL,
  invoice_date      date NOT NULL DEFAULT CURRENT_DATE,
  due_date          date NOT NULL,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  subtotal          numeric(12,2) NOT NULL DEFAULT 0,
  vat_rate          numeric(5,2) NOT NULL DEFAULT 20.00,
  vat_amount        numeric(12,2) NOT NULL DEFAULT 0,
  total             numeric(12,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  notes             text,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_number)
);

ALTER TABLE legal_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "li_select" ON legal_invoices FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "li_insert" ON legal_invoices FOR INSERT
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "li_update" ON legal_invoices FOR UPDATE
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "li_delete" ON legal_invoices FOR DELETE
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE INDEX idx_li_company ON legal_invoices(company_id);
CREATE INDEX idx_li_client ON legal_invoices(client_id);
CREATE INDEX idx_li_status ON legal_invoices(status);
CREATE INDEX idx_li_date ON legal_invoices(invoice_date DESC);

-- ── Legal invoice line items ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_invoice_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES legal_invoices(id) ON DELETE CASCADE,
  timesheet_entry_id uuid REFERENCES legal_timesheet_entries(id) ON DELETE SET NULL,
  employee_name     text NOT NULL,
  matter_name       text NOT NULL,
  date              date NOT NULL,
  description       text NOT NULL,
  task_code         text,
  hours             numeric(8,2) NOT NULL,
  rate              numeric(10,2) NOT NULL,
  amount            numeric(12,2) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE legal_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lil_select" ON legal_invoice_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM legal_invoices i WHERE i.id = invoice_id AND (i.company_id = get_my_company_id() OR is_super_admin())));
CREATE POLICY "lil_insert" ON legal_invoice_lines FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM legal_invoices i WHERE i.id = invoice_id AND (i.company_id = get_my_company_id() OR is_super_admin())));
CREATE POLICY "lil_update" ON legal_invoice_lines FOR UPDATE
  USING (EXISTS (SELECT 1 FROM legal_invoices i WHERE i.id = invoice_id AND (i.company_id = get_my_company_id() OR is_super_admin())));
CREATE POLICY "lil_delete" ON legal_invoice_lines FOR DELETE
  USING (EXISTS (SELECT 1 FROM legal_invoices i WHERE i.id = invoice_id AND (i.company_id = get_my_company_id() OR is_super_admin())));

CREATE INDEX idx_lil_invoice ON legal_invoice_lines(invoice_id);
CREATE INDEX idx_lil_entry ON legal_invoice_lines(timesheet_entry_id);
