# InflowHR — AI Development Standards

Multi-tenant HR SaaS on React + Supabase. Every tenant row has `company_id`. All dates en-GB (day-month-year).

## Commands

- Build: `npx tsc --noEmit && npx vite build`
- Lint: `npx oxlint`
- Dev server: port **3003** (configured in `.claude/launch.json`)
- Always highlight SQL the user needs to run — never assume they know which migrations to apply

## File naming

| Type | Convention | Example |
|------|-----------|---------|
| Pages / components | `PascalCase.tsx` | `AdminPayroll.tsx` |
| Admin pages | Prefix `Admin` | `AdminTimesheets.tsx` |
| Lib / utils | `camelCase.ts` | `formatters.ts` |
| SQL migrations | `NNN_snake_case.sql` | `103_revoke_remaining_anon.sql` |
| Edge functions | `kebab-case/index.ts` | `send-notification-email/index.ts` |
| Context files | `PascalCase + Context` | `AuthContext.tsx` |

## Database naming

- Tables and columns: `snake_case` (plural tables, singular columns)
- RLS policy names: human-readable quoted strings
- Functions: `snake_case` verb_noun pattern

## Context pattern

Every context follows: `createContext` → `XProvider` wrapper → `useX()` custom hook with guard.

## Security rules — every new table or function

1. Enable RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
2. Add SELECT/INSERT/UPDATE/DELETE policies scoped to `company_id = get_my_company_id()` with `OR is_super_admin()` fallback
3. Never use `USING(true)` on tenant data tables
4. SECURITY DEFINER functions must: check company ownership → check role → do work → end with REVOKE FROM anon + GRANT TO authenticated
5. REVOKE UPDATE, DELETE on audit/log tables from all roles

## PII handling

PII fields: `ni_number`, `bank_sort_code`, `bank_account_number`, `salary`, `date_of_birth`, `home_address`, `emergency_contact_*`, `religion`, `ethnicity`, `disability_*`

- Mask PII in admin UI (show last 4 chars only) — see `AdminEmployeeDetail` pattern
- Validate with `src/lib/validators.ts` (`validateNINumber`, `validateSortCode`, `validateAccountNumber`)
- Guard CSV exports against formula injection — see `src/lib/employeeDataExport.ts` `sanitiseForCsv()`
- All PII reads/writes/exports/deletions must call `log_gdpr_action()`:
  ```sql
  PERFORM log_gdpr_action(p_company_id, 'table_name', record_id::text, 'ACTION', old_data, new_data, NULL, metadata);
  ```

## Date formatting

Always use `src/lib/formatters.ts`: `formatDate()`, `formatDateFriendly()`, `formatDateTime()`. Never use `en-US` locale or month-first format.

## Edge function auth pattern

1. Extract Bearer token from Authorization header
2. `getUser()` to verify authentication
3. Verify company ownership via company_users
4. Check role (admin/hr/employee)
5. `escapeHtml()` all template interpolation
6. CORS restricted to `app.inflowhr.com`

## Feature flags

15 feature keys defined in `src/context/FeatureContext.tsx` `Features` interface. New features must add a key there and gate UI behind `features.feature_name`.

## UI change approval

If any change request has any form of UI impact or changes the admin or end user experience, **prompt for approval before implementing**. Describe what will change and which pages/components are affected, then wait for confirmation.

## Forbidden patterns

- `console.log()` / `console.debug()` in production code (console.warn/error OK for genuine error handling)
- Hardcoded API keys, tokens, or secrets
- `USING(true)` on any table with `company_id`
- `SELECT *` in SECURITY DEFINER functions
- Storing PII in `localStorage`

## Development process

1. Make changes
2. Run `npx tsc --noEmit` — fix any type errors
3. Run `npx vite build` — verify production build
4. Test on port 3003
5. Highlight any SQL migrations the user needs to run
6. Update `docs/go-to-market/CHANGELOG.md` for security/GDPR changes
