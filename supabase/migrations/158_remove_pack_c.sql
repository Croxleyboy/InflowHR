-- Migration: Remove Pack C, merge modulr_integration into Pack B (Pro Integrations)

-- 1. For any company that had pack_c enabled, ensure pack_b is also enabled
INSERT INTO company_features (company_id, feature_key, is_enabled, is_visible)
SELECT company_id, 'pack_b', true, true
FROM company_features
WHERE feature_key = 'pack_c' AND is_enabled = true
ON CONFLICT (company_id, feature_key)
DO UPDATE SET is_enabled = true;

-- 2. Remove pack_c rows from company_features
DELETE FROM company_features WHERE feature_key = 'pack_c';

-- 3. Mark pack_c pricing row as inactive
UPDATE subscription_pricing SET is_active = false WHERE feature_key = 'pack_c';

-- 4. Update pack_b display name in subscription_pricing
UPDATE subscription_pricing SET display_name = 'Pro Integrations' WHERE feature_key = 'pack_b';
