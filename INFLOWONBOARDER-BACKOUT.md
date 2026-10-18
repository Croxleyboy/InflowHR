# InflowOnboarder Integration — Backout Guide

How to fully revert the InflowOnboarder / Microsoft 365 provisioning integration.

## 1. Database — run against Supabase

```sql
DROP TABLE IF EXISTS onboarding_m365_actions;
DROP TABLE IF EXISTS inflowonboarder_integrations;
DELETE FROM subscription_pricing WHERE feature_key = 'inflowonboarder_integration';
DELETE FROM company_features WHERE feature_key = 'inflowonboarder_integration';
```

## 2. Edge Function secrets — remove

```bash
supabase secrets unset INFLOWONBOARDER_ENCRYPTION_KEY
supabase secrets unset INFLOWONBOARDER_API_URL
supabase secrets unset INFLOWONBOARDER_MOCK
```

## 3. Edge Function — delete

```bash
rm -rf supabase/functions/inflowonboarder/
```

## 4. Code changes — revert three files

| File | What to revert |
|------|----------------|
| `src/context/FeatureContext.tsx` | Remove `inflowonboarder_integration` from the `Features` interface, `ADDON_FEATURE_KEYS`, and `defaultFeatures` |
| `src/pages/admin/AdminIntegrations.tsx` | Remove the `InflowOnboarderIntegration` interface, `InflowOnboarderLogo` component, all `ifo*` state/handlers, the InflowOnboarder card JSX, and the InflowOnboarder modal |
| `src/pages/admin/AdminOnboarding.tsx` | Remove `session` from `useAuth()`, all `m365*` / `ifo*` state, `callIfo()` and M365 handler functions, the `loadM365Actions` call in `openWorkflow()`, and the M365 provisioning panel JSX in the accounts step |

## 5. Migration file — delete

```bash
rm supabase/migrations/201_inflowonboarder_integration.sql
```

## 6. Rebuild and deploy

```bash
npm run build
```

All InflowOnboarder UI is gated behind the `inflowonboarder_integration` feature flag, so disabling the feature in `company_features` (step 1 SQL) hides everything immediately — the code revert can follow at your own pace.
