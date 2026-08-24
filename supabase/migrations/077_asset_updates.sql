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

CREATE POLICY "Company scoped read" ON asset_updates
  FOR SELECT USING (can_access_company(company_id));

CREATE POLICY "Company scoped insert" ON asset_updates
  FOR INSERT WITH CHECK (can_access_company(company_id));

CREATE POLICY "Company scoped update" ON asset_updates
  FOR UPDATE USING (can_access_company(company_id));

CREATE POLICY "Company scoped delete" ON asset_updates
  FOR DELETE USING (can_access_company(company_id));
