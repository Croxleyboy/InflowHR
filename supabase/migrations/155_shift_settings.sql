-- Migration 155: Add shift-specific settings columns to app_settings
-- Supports the structured Settings tab in Shifts & Rotas

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS allow_shift_swaps BOOLEAN DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS swap_require_manager_approval BOOLEAN DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS swap_request_window_days INT DEFAULT 7;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS shift_reminder_enabled BOOLEAN DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS shift_reminder_hours_before INT DEFAULT 2;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS rota_published_notify BOOLEAN DEFAULT true;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS swap_notifications_enabled BOOLEAN DEFAULT true;
