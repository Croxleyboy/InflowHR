-- App-wide settings (single row)
CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  language TEXT NOT NULL DEFAULT 'en',
  financial_year_start_month INT NOT NULL DEFAULT 4,
  country_code TEXT NOT NULL DEFAULT 'GB',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_app_settings" ON app_settings FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_app_settings" ON app_settings FOR UPDATE TO anon USING (true);

INSERT INTO app_settings (language, financial_year_start_month, country_code)
VALUES ('en', 4, 'GB')
ON CONFLICT (id) DO NOTHING;

-- Translations table: source of truth for all app text
CREATE TABLE IF NOT EXISTS app_translations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  value TEXT NOT NULL,
  screen TEXT,
  UNIQUE(key, lang)
);

ALTER TABLE app_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_translations" ON app_translations FOR SELECT TO anon USING (true);
CREATE POLICY "anon_manage_translations" ON app_translations FOR ALL TO anon USING (true);

-- Seed English translations
INSERT INTO app_translations (key, lang, value, screen) VALUES
-- Dashboard
('dashboard.greeting_morning', 'en', 'Good Morning', 'dashboard'),
('dashboard.greeting_afternoon', 'en', 'Good Afternoon', 'dashboard'),
('dashboard.greeting_evening', 'en', 'Good Evening', 'dashboard'),
('dashboard.tagline', 'en', 'HR Info at your fingertips', 'dashboard'),
('dashboard.expenses', 'en', 'Expenses', 'dashboard'),
('dashboard.last_claim', 'en', 'last claim', 'dashboard'),
('dashboard.leave_remaining', 'en', 'Leave Remaining', 'dashboard'),
('dashboard.days', 'en', 'Days', 'dashboard'),
('dashboard.my_profile', 'en', 'My Profile', 'dashboard'),
('dashboard.payslips', 'en', 'Payslips', 'dashboard'),
('dashboard.kudos', 'en', 'Kudos', 'dashboard'),
('dashboard.benefits', 'en', 'Benefits', 'dashboard'),
('dashboard.elearning', 'en', 'E-Learning', 'dashboard'),
('dashboard.performance', 'en', 'Performance', 'dashboard'),
('dashboard.announcements', 'en', 'Company Announcements', 'dashboard'),
-- Expenses
('expenses.title', 'en', 'My', 'expenses'),
('expenses.title_accent', 'en', 'Expenses', 'expenses'),
('expenses.subtitle', 'en', 'View and submit Expense claims', 'expenses'),
('expenses.total_claims', 'en', 'Total Claims', 'expenses'),
('expenses.approved', 'en', 'Approved', 'expenses'),
('expenses.pending', 'en', 'Pending', 'expenses'),
('expenses.draft', 'en', 'Draft', 'expenses'),
('expenses.submitted', 'en', 'Submitted', 'expenses'),
('expenses.all', 'en', 'All', 'expenses'),
('expenses.add_new', 'en', 'Add New Expense Claim', 'expenses'),
('expenses.loading', 'en', 'Loading claims...', 'expenses'),
('expenses.no_claims', 'en', 'No claims found.', 'expenses'),
('expenses.graph_title', 'en', 'Expense Overview', 'expenses'),
-- Expense Detail
('expense_detail.title', 'en', 'Expense Details', 'expense_detail'),
('expense_detail.status', 'en', 'Status', 'expense_detail'),
('expense_detail.reference', 'en', 'Reference', 'expense_detail'),
('expense_detail.created', 'en', 'Created', 'expense_detail'),
('expense_detail.add_line', 'en', 'Add a new line item', 'expense_detail'),
('expense_detail.line_items', 'en', 'Line items', 'expense_detail'),
('expense_detail.submit', 'en', 'Submit', 'expense_detail'),
('expense_detail.submitting', 'en', 'Submitting...', 'expense_detail'),
-- Notifications
('notifications.title', 'en', 'My Notifications & Actions', 'notifications'),
('notifications.company', 'en', 'Company', 'notifications'),
('notifications.my_actions', 'en', 'My Actions', 'notifications'),
('notifications.my_notifications', 'en', 'My Notifications', 'notifications'),
('notifications.company_title', 'en', 'Company Notifications', 'notifications'),
('notifications.upcoming_leave', 'en', 'Upcoming Leave', 'notifications'),
('notifications.no_upcoming', 'en', 'No upcoming leave', 'notifications'),
('notifications.book_time_off', 'en', 'Book some time off', 'notifications'),
('notifications.no_actions', 'en', 'No pending actions.', 'notifications'),
('notifications.no_notifs', 'en', 'No notifications yet.', 'notifications'),
('notifications.no_announcements', 'en', 'No company announcements.', 'notifications'),
-- Approval
('approval.expense_title', 'en', 'Expense Approval', 'approval'),
('approval.leave_title', 'en', 'Leave Details', 'approval'),
('approval.approve', 'en', 'Approve', 'approval'),
('approval.decline', 'en', 'Decline', 'approval'),
('approval.delete_claim', 'en', 'Delete Claim', 'approval'),
('approval.delete_request', 'en', 'Delete Request', 'approval'),
('approval.response_placeholder', 'en', 'Write a response...', 'approval'),
('approval.total_amount', 'en', 'Total Amount', 'approval'),
-- Settings
('settings.title', 'en', 'Settings', 'settings'),
('settings.profile', 'en', 'Profile', 'settings'),
('settings.name', 'en', 'Name', 'settings'),
('settings.email', 'en', 'Email', 'settings'),
('settings.role', 'en', 'Role', 'settings'),
('settings.app_info', 'en', 'App Info', 'settings'),
('settings.version', 'en', 'Version', 'settings'),
('settings.environment', 'en', 'Environment', 'settings'),
('settings.language', 'en', 'Language', 'settings'),
('settings.features', 'en', 'Dashboard Features', 'settings'),
('settings.features_hint', 'en', 'Toggle features visible on the dashboard', 'settings'),
('settings.save', 'en', 'Save', 'settings'),
('settings.saved', 'en', 'Saved!', 'settings'),
('settings.app_settings', 'en', 'App Settings', 'settings'),
('settings.financial_year', 'en', 'Financial Year Start', 'settings'),
-- Footer
('footer.dashboard', 'en', 'Dashboard', 'footer'),
('footer.time_off', 'en', 'Time-off', 'footer'),
('footer.notifications', 'en', 'Notifications', 'footer'),
('footer.settings', 'en', 'Settings', 'footer'),
-- Common
('common.loading', 'en', 'Loading...', 'common'),
('common.error', 'en', 'Error', 'common'),
('common.delete', 'en', 'Delete', 'common'),
('common.cancel', 'en', 'Cancel', 'common'),
('common.confirm', 'en', 'Confirm', 'common'),
('common.submitted_by', 'en', 'Submitted By', 'common'),
('common.action', 'en', 'Action', 'common')
ON CONFLICT (key, lang) DO NOTHING;

-- Seed German translations
INSERT INTO app_translations (key, lang, value, screen) VALUES
-- Dashboard
('dashboard.greeting_morning', 'de', 'Guten Morgen', 'dashboard'),
('dashboard.greeting_afternoon', 'de', 'Guten Tag', 'dashboard'),
('dashboard.greeting_evening', 'de', 'Guten Abend', 'dashboard'),
('dashboard.tagline', 'de', 'HR-Info griffbereit', 'dashboard'),
('dashboard.expenses', 'de', 'Ausgaben', 'dashboard'),
('dashboard.last_claim', 'de', 'letzte', 'dashboard'),
('dashboard.leave_remaining', 'de', 'Resturlaub', 'dashboard'),
('dashboard.days', 'de', 'Tage', 'dashboard'),
('dashboard.my_profile', 'de', 'Mein Profil', 'dashboard'),
('dashboard.payslips', 'de', 'Gehaltsübersicht', 'dashboard'),
('dashboard.kudos', 'de', 'Lob', 'dashboard'),
('dashboard.benefits', 'de', 'Vorteile', 'dashboard'),
('dashboard.elearning', 'de', 'E-Learning', 'dashboard'),
('dashboard.performance', 'de', 'Leistung', 'dashboard'),
('dashboard.announcements', 'de', 'Firmenmitteilungen', 'dashboard'),
-- Expenses
('expenses.title', 'de', 'Meine', 'expenses'),
('expenses.title_accent', 'de', 'Ausgaben', 'expenses'),
('expenses.subtitle', 'de', 'Spesen einsehen und einreichen', 'expenses'),
('expenses.total_claims', 'de', 'Gesamt', 'expenses'),
('expenses.approved', 'de', 'Genehmigt', 'expenses'),
('expenses.pending', 'de', 'Offen', 'expenses'),
('expenses.draft', 'de', 'Entwurf', 'expenses'),
('expenses.submitted', 'de', 'Eingereicht', 'expenses'),
('expenses.all', 'de', 'Alle', 'expenses'),
('expenses.add_new', 'de', 'Neue Spesenabrechnung', 'expenses'),
('expenses.loading', 'de', 'Laden...', 'expenses'),
('expenses.no_claims', 'de', 'Keine Anträge.', 'expenses'),
('expenses.graph_title', 'de', 'Spesenübersicht', 'expenses'),
-- Expense Detail
('expense_detail.title', 'de', 'Spesendetails', 'expense_detail'),
('expense_detail.status', 'de', 'Status', 'expense_detail'),
('expense_detail.reference', 'de', 'Referenz', 'expense_detail'),
('expense_detail.created', 'de', 'Erstellt', 'expense_detail'),
('expense_detail.add_line', 'de', 'Position hinzufügen', 'expense_detail'),
('expense_detail.line_items', 'de', 'Positionen', 'expense_detail'),
('expense_detail.submit', 'de', 'Einreichen', 'expense_detail'),
('expense_detail.submitting', 'de', 'Wird eingereicht...', 'expense_detail'),
-- Notifications
('notifications.title', 'de', 'Meine Benachrichtigungen', 'notifications'),
('notifications.company', 'de', 'Firma', 'notifications'),
('notifications.my_actions', 'de', 'Aufgaben', 'notifications'),
('notifications.my_notifications', 'de', 'Meldungen', 'notifications'),
('notifications.company_title', 'de', 'Firmenmitteilungen', 'notifications'),
('notifications.upcoming_leave', 'de', 'Kommender Urlaub', 'notifications'),
('notifications.no_upcoming', 'de', 'Kein Urlaub geplant', 'notifications'),
('notifications.book_time_off', 'de', 'Urlaub buchen', 'notifications'),
('notifications.no_actions', 'de', 'Keine Aufgaben.', 'notifications'),
('notifications.no_notifs', 'de', 'Keine Meldungen.', 'notifications'),
('notifications.no_announcements', 'de', 'Keine Mitteilungen.', 'notifications'),
-- Approval
('approval.expense_title', 'de', 'Spesenprüfung', 'approval'),
('approval.leave_title', 'de', 'Urlaubsdetails', 'approval'),
('approval.approve', 'de', 'Genehmigen', 'approval'),
('approval.decline', 'de', 'Ablehnen', 'approval'),
('approval.delete_claim', 'de', 'Antrag löschen', 'approval'),
('approval.delete_request', 'de', 'Anfrage löschen', 'approval'),
('approval.response_placeholder', 'de', 'Antwort schreiben...', 'approval'),
('approval.total_amount', 'de', 'Gesamtbetrag', 'approval'),
-- Settings
('settings.title', 'de', 'Einstellungen', 'settings'),
('settings.profile', 'de', 'Profil', 'settings'),
('settings.name', 'de', 'Name', 'settings'),
('settings.email', 'de', 'E-Mail', 'settings'),
('settings.role', 'de', 'Rolle', 'settings'),
('settings.app_info', 'de', 'App-Info', 'settings'),
('settings.version', 'de', 'Version', 'settings'),
('settings.environment', 'de', 'Umgebung', 'settings'),
('settings.language', 'de', 'Sprache', 'settings'),
('settings.features', 'de', 'Dashboard-Funktionen', 'settings'),
('settings.features_hint', 'de', 'Funktionen auf dem Dashboard ein-/ausblenden', 'settings'),
('settings.save', 'de', 'Speichern', 'settings'),
('settings.saved', 'de', 'Gespeichert!', 'settings'),
('settings.app_settings', 'de', 'App-Einstellungen', 'settings'),
('settings.financial_year', 'de', 'Geschäftsjahresbeginn', 'settings'),
-- Footer
('footer.dashboard', 'de', 'Start', 'footer'),
('footer.time_off', 'de', 'Urlaub', 'footer'),
('footer.notifications', 'de', 'Meldungen', 'footer'),
('footer.settings', 'de', 'Einstellungen', 'footer'),
-- Common
('common.loading', 'de', 'Laden...', 'common'),
('common.error', 'de', 'Fehler', 'common'),
('common.delete', 'de', 'Löschen', 'common'),
('common.cancel', 'de', 'Abbrechen', 'common'),
('common.confirm', 'de', 'Bestätigen', 'common'),
('common.submitted_by', 'de', 'Eingereicht von', 'common'),
('common.action', 'de', 'Aktion', 'common')
ON CONFLICT (key, lang) DO NOTHING;
