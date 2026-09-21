-- Migration 107: Teams Bot Framework configuration
-- Adds bot credentials to company_teams_config and a table to store
-- per-user conversation references for proactive bot messaging.
-- This replaces the delegated OAuth approach for sending Teams messages.

-- ============================================================
-- 1. Add bot credential columns to company_teams_config
-- ============================================================

ALTER TABLE company_teams_config
  ADD COLUMN IF NOT EXISTS azure_tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS bot_app_id TEXT,
  ADD COLUMN IF NOT EXISTS bot_app_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS bot_configured BOOLEAN NOT NULL DEFAULT FALSE;


-- ============================================================
-- 2. Per-user Bot Framework conversation references
-- ============================================================

CREATE TABLE IF NOT EXISTS company_teams_bot_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  service_url TEXT NOT NULL,
  bot_user_id TEXT,
  tenant_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_email)
);

ALTER TABLE company_teams_bot_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company admins can read own bot conversations"
  ON company_teams_bot_conversations FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

-- INSERT/UPDATE/DELETE handled by Edge Functions using service role key
