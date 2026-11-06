ALTER TABLE companies ADD COLUMN IF NOT EXISTS bacs_originator_sort_code TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bacs_originator_account_no TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bacs_originator_name TEXT;
