# InflowHR Development Standards

Human-readable reference for contributors and auditors. AI-enforced standards are in `CLAUDE.md` (project root).

## Architecture Overview

```
src/
├── context/           # React contexts (AuthContext, FeatureContext, etc.)
├── components/        # Shared UI components
├── lib/               # Utilities (supabase client, formatters, validators)
├── pages/
│   ├── Admin*.tsx      # Admin-facing pages (PascalCase, prefixed "Admin")
│   └── *.tsx           # Employee-facing pages
supabase/
├── migrations/        # Sequential SQL migrations (NNN_snake_case.sql)
├── functions/         # Edge Functions (kebab-case/index.ts)
docs/                  # Standards, reports, changelogs
.claude/               # AI development framework
├── rules/sql.md       # SQL-scoped rules
├── skills/            # Reusable workflow templates
├── settings.json      # Hook-based enforcement
└── launch.json        # Dev server config (port 3003)
```

## Naming Conventions

Verified against industry standards (Airbnb React Style Guide, PostgreSQL conventions, Supabase docs):

| Type | Convention | Rating | Source |
|------|-----------|--------|--------|
| React pages/components | `PascalCase.tsx` | Standard | Airbnb React/JSX Style Guide |
| TypeScript libs | `camelCase.ts` | Acceptable | TypeScript Blackbook |
| SQL migrations | `NNN_snake_case.sql` | Acceptable | Supabase/Flyway convention |
| PostgreSQL identifiers | `snake_case` | Standard | PostgreSQL naming conventions |
| Edge Functions | `kebab-case/index.ts` | Standard | Supabase Edge Functions docs |
| Context pattern | `createContext + Provider + useX` | Standard | React official docs |

## Security Review Checklist

For every new feature or change touching database or auth:

1. [ ] New tables have RLS enabled
2. [ ] All RLS policies scope to `company_id = get_my_company_id()`
3. [ ] SELECT policies include `OR is_super_admin()` fallback
4. [ ] Write policies check role via `company_users` table
5. [ ] No `USING(true)` on any table with `company_id`
6. [ ] SECURITY DEFINER functions have REVOKE FROM anon + GRANT TO authenticated
7. [ ] Audit/log tables have REVOKE UPDATE, DELETE from all roles
8. [ ] Edge Functions verify Bearer token and company membership
9. [ ] No API keys, tokens, or secrets in source code
10. [ ] No `console.log()` or `console.debug()` (warn/error OK for genuine errors)
11. [ ] CSV/data exports guard against formula injection (`sanitiseForCsv()`)
12. [ ] PII fields masked in admin UI (show last 4 chars only)

## GDPR Compliance Checklist for New Features

For any feature that touches personal data:

1. [ ] PII operations call `log_gdpr_action()` with correct action type
2. [ ] New PII fields added to the export function (`export_employee_data`)
3. [ ] New PII fields added to the anonymisation function (`anonymise_employee`)
4. [ ] Data retention policies cover the new data (via `pg_cron` jobs)
5. [ ] Employee consent captured if processing new sensitive categories
6. [ ] Privacy notice updated if new processing purposes added
7. [ ] All dates formatted as DD-MM-YYYY (en-GB) using `src/lib/formatters.ts`
8. [ ] Changes documented in `docs/CHANGELOG.md` with GDPR impact

## Component Patterns

### Context Provider
```tsx
// XContext.tsx
const XContext = createContext<XContextType>(defaultValue)
export function useX() { return useContext(XContext) }
export function XProvider({ children }: { children: ReactNode }) {
  // state and effects
  return <XContext.Provider value={value}>{children}</XContext.Provider>
}
```

### Date Formatting
```tsx
import { formatDate, formatDateFriendly, formatDateTime } from '../lib/formatters'
// Always en-GB: 19-09-2026, 19 September 2026, 19-09-2026 14:30
```

### PII Validation
```tsx
import { validateNINumber, validateSortCode, validateAccountNumber } from '../lib/validators'
```

## External References

- [Supabase Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [OWASP Top 10 for LLM Applications 2026](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/)
- [ICO Guidance on AI and Data Protection](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/)
- [Airbnb React/JSX Style Guide](https://github.com/airbnb/javascript/tree/master/react)
- [Supabase Shared Responsibility Model](https://supabase.com/docs/guides/deployment/shared-responsibility-model)

## Audit Trail

All security and GDPR changes are tracked in `docs/CHANGELOG.md`. Three independent security audits completed September 2026:

1. **Manual code review** (CodeRabbit) — 10 findings, all fixed
2. **Automated audit** (CodeRabbit) — 18 findings, all fixed
3. **SAST scan** (Semgrep) — 3 findings, all fixed

Total: 31 findings found, 31 fixed. Evidence report: `docs/inflowhr-security-evidence.html`
