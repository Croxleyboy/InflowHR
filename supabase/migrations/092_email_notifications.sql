-- Email notification settings per company
CREATE TABLE IF NOT EXISTS email_notification_settings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  leave_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  expenses_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  shifts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  kudos_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  space_booking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  performance_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  elearning_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id)
);

ALTER TABLE email_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read email notification settings"
  ON email_notification_settings FOR SELECT
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Admin write email notification settings"
  ON email_notification_settings FOR ALL
  USING (company_id = get_my_company_id() OR is_super_admin());

-- Seed the subscription_pricing row for Email Notifications add-on
INSERT INTO subscription_pricing (feature_key, display_name, description, default_price, is_addon, is_active)
VALUES ('email_notifications', 'Email Notifications', 'Automated confirmation and reminder emails for HR features via Brevo', 2.00, true, true)
ON CONFLICT (feature_key) DO NOTHING;
