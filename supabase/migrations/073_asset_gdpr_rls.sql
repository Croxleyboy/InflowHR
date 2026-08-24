-- Migration 073: Apply GDPR consent-gated RLS to company_assets and asset_history
-- Super admin access to asset data now requires an active tenant_support_access grant
-- GDPR Art. 28 — Processor acts only on controller's instructions

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['company_assets', 'asset_history'])
  LOOP
    -- Enable RLS if not already enabled
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- Drop any existing policies
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped insert" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped update" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Company scoped delete" ON %I', tbl);

    -- GDPR-compliant: super_admin access requires active support grant
    EXECUTE format(
      'CREATE POLICY "Company scoped read" ON %I FOR SELECT
       USING (can_access_company(company_id))', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped insert" ON %I FOR INSERT
       WITH CHECK (can_access_company(company_id))', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped update" ON %I FOR UPDATE
       USING (can_access_company(company_id))', tbl);
    EXECUTE format(
      'CREATE POLICY "Company scoped delete" ON %I FOR DELETE
       USING (can_access_company(company_id))', tbl);
  END LOOP;
END $$;
