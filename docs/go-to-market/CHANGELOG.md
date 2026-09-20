# InflowHR Change Log
**Last updated:** 20-09-2026

Format: `DD-MM-YYYY | Category | Description | PR/Migration | GDPR Impact`

Categories: `SECURITY` `FEATURE` `FIX` `GDPR` `INFRASTRUCTURE` `REFACTOR`

---

## September 2026

### Security Audit Phase 1 — Manual Code Review (CodeRabbit)

| Date | Category | Description | Reference | GDPR Impact |
|------|----------|-------------|-----------|-------------|
| 05-09-2026 | SECURITY | SEC-C01: Fix admin_portal cross-tenant RLS | PR #49, migration 087 | Prevents cross-tenant data access |
| 05-09-2026 | SECURITY | SEC-C02: Add auth to send-notification-email Edge Function | PR #49 | Prevents unauthenticated email sends |
| 05-09-2026 | SECURITY | SEC-C03: Lock down app_translations anon access | PR #49, migration 087 | Reduces attack surface |
| 05-09-2026 | SECURITY | SEC-H01: Make receipts bucket private + scope delete | PR #49, migration 087 | Protects uploaded PII documents |
| 05-09-2026 | SECURITY | SEC-H02: Create super_admins table, replace hardcoded emails | PR #49, migration 093 | Removes credentials from source |
| 05-09-2026 | SECURITY | SEC-H03: Fix delete_company_data RLS disable | PR #49, migration 087 | Prevents RLS bypass during deletion |
| 05-09-2026 | SECURITY | SEC-H04: Restrict CORS to app.inflowhr.com | PR #49 | Prevents cross-origin attacks |
| 05-09-2026 | SECURITY | SEC-H05: Sign xero-callback state parameter | PR #49 | Prevents CSRF on OAuth callback |
| 05-09-2026 | SECURITY | SEC-H06: HTML-escape email template interpolation | PR #49 | Prevents XSS in emails |
| 05-09-2026 | SECURITY | SEC-M01–M07: Medium security fixes | PR #49 | Various tenant isolation improvements |

### Security Audit Phase 2 — Automated Audit (CodeRabbit)

| Date | Category | Description | Reference | GDPR Impact |
|------|----------|-------------|-----------|-------------|
| 08-09-2026 | SECURITY | SEC-01: Lock down delete_company_data RPC | PR #46, migration 054 | Prevents unauthorised data deletion |
| 08-09-2026 | SECURITY | SEC-02: Lock down promote_employee_to_admin RPC | PR #46, migration 054 | Prevents privilege escalation |
| 08-09-2026 | SECURITY | SEC-03: Fix elearning_courses open write policy | PR #46, migration 054 | Prevents cross-tenant writes |
| 08-09-2026 | SECURITY | SEC-04: Add PII input validation | PR #46, src/lib/validators.ts | Validates NI, sort code, account number |
| 08-09-2026 | SECURITY | SEC-H01–H06: High severity fixes | PR #47, migration 055 | RLS, PII masking, injection guards |
| 08-09-2026 | SECURITY | SEC-15–24: Medium severity fixes | PR #48, migrations 056-058 | GDPR logging, data retention, portability |

### Security Audit Phase 3 — SAST Scan (Semgrep)

| Date | Category | Description | Reference | GDPR Impact |
|------|----------|-------------|-----------|-------------|
| 15-09-2026 | SECURITY | SG-01: Rewrite get_super_admin_uid() | PR #52, migration 102 | Removes hardcoded email from function |
| 15-09-2026 | SECURITY | SG-02: REVOKE EXECUTE FROM anon on 7 functions | PR #52, migration 102 | Defence-in-depth on SECURITY DEFINER |
| 15-09-2026 | SECURITY | SG-03: Drop overly-permissive app_settings policy | PR #52, migration 102 | Removes USING(true) on tenant data |

### Development Framework

| Date | Category | Description | Reference | GDPR Impact |
|------|----------|-------------|-----------|-------------|
| 19-09-2026 | INFRASTRUCTURE | AI development framework (CLAUDE.md, rules, hooks, skills) | — | Embeds GDPR guardrails into dev process |
| 19-09-2026 | SECURITY | REVOKE remaining 10 SECURITY DEFINER functions from anon | migration 103 | Defence-in-depth on GDPR functions |
| 19-09-2026 | GDPR | Subprocessor list documenting all third-party data processors | docs/SUBPROCESSORS.md | GDPR Article 28 compliance |
| 19-09-2026 | INFRASTRUCTURE | Backup & recovery plan with RPO/RTO targets | docs/BACKUP_AND_RECOVERY.md | Supports GDPR Article 32 |
| 19-09-2026 | SECURITY | Vulnerability disclosure policy (security.txt) | public/.well-known/security.txt | Responsible disclosure process |
| 20-09-2026 | GDPR | Incident response plan with ICO notification procedures | docs/go-to-market/INCIDENT_RESPONSE_PLAN.md | GDPR Articles 33-34 compliance |
| 20-09-2026 | INFRASTRUCTURE | Service level agreement with uptime targets and credits | docs/go-to-market/SERVICE_LEVEL_AGREEMENT.md | Customer assurance |
| 20-09-2026 | INFRASTRUCTURE | Consolidated go-to-market documentation folder | docs/go-to-market/ | All compliance docs in one place |

---

## Template for new entries

```
| DD-MM-YYYY | CATEGORY | Brief description | PR #N, migration NNN | GDPR impact or "None" |
```
