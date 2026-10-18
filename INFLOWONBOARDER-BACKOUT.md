# InflowOnboarder Integration — Backout Guide

How to fully revert the InflowOnboarder / Microsoft 365 provisioning integration.

## Quick disable (no data loss)

Disabling the feature flag hides all InflowOnboarder UI immediately — the full revert below can follow at your own pace.

```sql
UPDATE company_features SET enabled = false WHERE feature_key = 'inflowonboarder_integration';
```

---

## Full revert

### 1. Database — revert v2 columns (keep v1 tables)

```sql
-- Remove v2 columns from integrations settings
ALTER TABLE inflowonboarder_integrations
  DROP COLUMN IF EXISTS approver_mode,
  DROP COLUMN IF EXISTS approver_name,
  DROP COLUMN IF EXISTS approver_email,
  DROP COLUMN IF EXISTS licence_manager_name,
  DROP COLUMN IF EXISTS licence_manager_email,
  DROP COLUMN IF EXISTS licence_sku_id,
  DROP COLUMN IF EXISTS licence_sku_name,
  DROP COLUMN IF EXISTS group_name,
  DROP COLUMN IF EXISTS account_domain,
  DROP COLUMN IF EXISTS settings_updated_at,
  DROP COLUMN IF EXISTS settings_updated_by;

-- Remove v2 columns from m365 actions
ALTER TABLE onboarding_m365_actions
  DROP COLUMN IF EXISTS run_id,
  DROP COLUMN IF EXISTS run_status,
  DROP COLUMN IF EXISTS run_error,
  DROP COLUMN IF EXISTS run_result,
  DROP COLUMN IF EXISTS approval_sent_at,
  DROP COLUMN IF EXISTS approval_status,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS attempt_count_run,
  DROP COLUMN IF EXISTS is_v1_legacy;
```

### 2. Database — full removal (drops everything)

```sql
DROP TABLE IF EXISTS onboarding_m365_actions;
DROP TABLE IF EXISTS inflowonboarder_integrations;
DELETE FROM subscription_pricing WHERE feature_key = 'inflowonboarder_integration';
DELETE FROM company_features WHERE feature_key = 'inflowonboarder_integration';

-- Remove any M365 Provisioning workflow tracker + notification rows
DELETE FROM workflow_tracker WHERE record_type = 'M365 Provisioning';
DELETE FROM notifications WHERE notification_type = 'm365_approval';
```

### 3. Edge Function secrets — remove

```bash
supabase secrets unset INFLOWONBOARDER_ENCRYPTION_KEY
supabase secrets unset INFLOWONBOARDER_API_URL
supabase secrets unset INFLOWONBOARDER_MOCK
supabase secrets unset INFLOWONBOARDER_MOCK_NO_LICENCE
```

### 4. Edge Function — delete

```bash
rm -rf supabase/functions/inflowonboarder/
```

### 5. Code changes — revert files

| File | What to revert |
|------|----------------|
| `src/context/FeatureContext.tsx` | Remove `inflowonboarder_integration` from the `Features` interface, `ADDON_FEATURE_KEYS`, and `defaultFeatures` |
| `src/pages/admin/AdminIntegrations.tsx` | Remove the `InflowOnboarderIntegration` interface, `InflowOnboarderLogo` component, all `ifo*` state/handlers, the InflowOnboarder card JSX, the settings panel, and the InflowOnboarder modal |
| `src/pages/admin/AdminOnboarding.tsx` | Remove `session` from `useAuth()`, all `m365*` / `ifo*` state, v2 handler functions (`m365StartRun`, `m365PollRun`, `m365RecheckRun`, `m365SendApproval`, `m365ProceedRun`, `m365MarkCompleteManual`), the `loadM365Actions` call in `openWorkflow()`, and the M365 provisioning panel JSX in the accounts step |
| `src/pages/Notifications.tsx` | Remove `m365ActionItem` / `m365Approving` state, `handleM365Approval` handler, M365 Provisioning approval modal, and M365 cases in `getActionTitle`, `getNotifTitle`, `handleActionClick`, `NotifIcon`, action card bar/arrow colours |
| `src/pages/Dashboard.tsx` | Remove `M365 Provisioning` case from task label and detail mappings |

### 6. Migration files — delete

```bash
rm supabase/migrations/201_inflowonboarder_integration.sql
rm supabase/migrations/202_inflowonboarder_v2.sql
```

### 7. Rebuild and deploy

```bash
npm run build
```
