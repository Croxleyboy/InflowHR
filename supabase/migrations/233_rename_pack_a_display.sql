-- Rename Pack A display name from "Workforce & Operations" to "People Operations"
UPDATE subscription_pricing
SET display_name = 'People Operations',
    description = 'Shifts & Rotas, Legal Timesheets, Space & Desk Booking, Asset Management'
WHERE feature_key = 'pack_a';
