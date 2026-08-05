-- Per-company financial year start month (1=Jan … 12=Dec, default 4=April for UK)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fy_start_month smallint NOT NULL DEFAULT 4;
