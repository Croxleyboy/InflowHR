-- Add dashboard_style column to companies table
-- 'default' = existing full-size cards, 'slim' = half-height feature cards (expenses/leave stay full)
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS dashboard_style text NOT NULL DEFAULT 'default'
CHECK (dashboard_style IN ('default', 'slim'));
