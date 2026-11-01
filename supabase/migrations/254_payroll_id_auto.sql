-- Auto-generate payroll IDs and track tax code source

-- Company payroll prefix (e.g. "ACM") and next sequence number
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS payroll_prefix TEXT,
  ADD COLUMN IF NOT EXISTS payroll_seq INTEGER DEFAULT 0;

-- Track source/last update of payroll fields on employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS payroll_id_source TEXT DEFAULT 'manual'
    CHECK (payroll_id_source IN ('manual','auto','xero','sage','csv')),
  ADD COLUMN IF NOT EXISTS payroll_id_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tax_code_source TEXT DEFAULT 'manual'
    CHECK (tax_code_source IN ('manual','auto','xero','sage','csv')),
  ADD COLUMN IF NOT EXISTS tax_code_updated_at TIMESTAMPTZ;

-- Generate a payroll prefix from company name: first 3 uppercase letters, deduped
CREATE OR REPLACE FUNCTION generate_payroll_prefix(p_company_id uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_base TEXT;
  v_prefix TEXT;
  v_suffix INTEGER := 0;
BEGIN
  SELECT name INTO v_name FROM companies WHERE id = p_company_id;
  IF v_name IS NULL THEN RETURN 'EMP'; END IF;

  v_base := UPPER(REGEXP_REPLACE(LEFT(v_name, 3), '[^A-Z]', '', 'g'));
  IF LENGTH(v_base) < 2 THEN v_base := 'EMP'; END IF;

  v_prefix := v_base;
  WHILE EXISTS (SELECT 1 FROM companies WHERE payroll_prefix = v_prefix AND id != p_company_id) LOOP
    v_suffix := v_suffix + 1;
    v_prefix := v_base || v_suffix::TEXT;
  END LOOP;

  UPDATE companies SET payroll_prefix = v_prefix WHERE id = p_company_id AND payroll_prefix IS NULL;
  RETURN v_prefix;
END;
$$;

-- Generate next payroll ID for a company: PREFIX-NNN
CREATE OR REPLACE FUNCTION next_payroll_id(p_company_id uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_seq INTEGER;
  v_id TEXT;
BEGIN
  SELECT payroll_prefix INTO v_prefix FROM companies WHERE id = p_company_id;
  IF v_prefix IS NULL THEN
    v_prefix := generate_payroll_prefix(p_company_id);
  END IF;

  UPDATE companies SET payroll_seq = COALESCE(payroll_seq, 0) + 1
    WHERE id = p_company_id
    RETURNING payroll_seq INTO v_seq;

  v_id := v_prefix || '-' || LPAD(v_seq::TEXT, 3, '0');

  -- Ensure uniqueness within company
  WHILE EXISTS (SELECT 1 FROM employees WHERE payroll_id = v_id AND company_id = p_company_id) LOOP
    UPDATE companies SET payroll_seq = payroll_seq + 1 WHERE id = p_company_id RETURNING payroll_seq INTO v_seq;
    v_id := v_prefix || '-' || LPAD(v_seq::TEXT, 3, '0');
  END LOOP;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_payroll_prefix(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION next_payroll_id(uuid) TO authenticated;

-- Backfill: set payroll_prefix and payroll_seq for existing companies
DO $$
DECLARE
  r RECORD;
  v_prefix TEXT;
  v_max_seq INTEGER;
BEGIN
  FOR r IN
    SELECT DISTINCT c.id
    FROM companies c
    JOIN employees e ON e.company_id = c.id
    WHERE c.payroll_prefix IS NULL
  LOOP
    v_prefix := generate_payroll_prefix(r.id);

    SELECT COALESCE(MAX(
      CASE WHEN e.payroll_id ~ ('^' || v_prefix || '-[0-9]+$')
      THEN CAST(SUBSTRING(e.payroll_id FROM LENGTH(v_prefix) + 2) AS INTEGER)
      ELSE 0 END
    ), 0) INTO v_max_seq
    FROM employees e WHERE e.company_id = r.id AND e.payroll_id IS NOT NULL;

    UPDATE companies SET payroll_seq = v_max_seq WHERE id = r.id;
  END LOOP;
END;
$$;
