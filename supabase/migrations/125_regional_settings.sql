-- Regional settings per company: timezone, date format, currency.
-- Defaults to UK (Europe/London, DD/MM/YYYY, GBP).

ALTER TABLE companies ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/London';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'GBP';
