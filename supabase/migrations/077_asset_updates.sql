-- Migration 077: Add asset_updates table for tracking multiple updates per asset
CREATE TABLE IF NOT EXISTS asset_updates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES company_assets(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  update_note text NOT NULL DEFAULT '',
  updated_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_updates_asset ON asset_updates(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_updates_company ON asset_updates(company_id);

ALTER TABLE asset_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asset_updates_select" ON asset_updates
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "asset_updates_insert" ON asset_updates
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND is_active = true AND role IN ('admin', 'hr')
    )
  );

CREATE POLICY "asset_updates_update" ON asset_updates
  FOR UPDATE USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND is_active = true AND role IN ('admin', 'hr')
    )
  );

CREATE POLICY "asset_updates_delete" ON asset_updates
  FOR DELETE USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE auth_user_id = auth.uid() AND is_active = true AND role IN ('admin', 'hr')
    )
  );
