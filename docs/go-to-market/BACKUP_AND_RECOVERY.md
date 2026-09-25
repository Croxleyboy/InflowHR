# InflowHR — Backup, Recovery & Business Continuity

**Last updated:** 25-09-2026

## Recovery Objectives

| Metric | Target | How achieved |
|--------|--------|-------------|
| **RPO** (Recovery Point Objective) | **24 hours** | Supabase Pro performs daily automated backups. Point-in-time recovery (PITR) available on Team/Enterprise plans for near-zero RPO. |
| **RTO** (Recovery Time Objective) | **4 hours** | Database restore from Supabase backup + redeployment of application from Git. |
| **Uptime SLA** | **99.9%** | Supabase Pro SLA. Application hosted on Supabase Edge (global CDN). |

## Backup Strategy

### Database (Supabase/PostgreSQL)

| Backup type | Frequency | Retention | Encryption |
|------------|-----------|-----------|------------|
| Automated daily backup | Every 24 hours | 7 days (Pro), 14 days (Team) | AES-256 at rest |
| Point-in-time recovery | Continuous WAL archiving | Up to retention window | AES-256 at rest |
| Company-level export | On-demand (super admin) | Retained as ZIP archive in storage | AES-256 at rest |

### File Storage (Supabase Storage)

| Content | Backup | Encryption |
|---------|--------|------------|
| Employee receipts | Included in Supabase backup | AES-256 at rest, TLS in transit |
| Employee documents | Included in Supabase backup (private bucket `employee-documents`) | AES-256 at rest, TLS in transit |
| Company archives | Stored as ZIP with all associated files | AES-256 at rest |
| Profile avatars | Included in Supabase backup | AES-256 at rest |

### Application Code

| Asset | Backup | Location |
|-------|--------|----------|
| Source code | Git version control | GitHub (private repository) |
| Migrations | Sequential SQL files in repository | GitHub + applied to database |
| Edge Functions | Deployed from repository | GitHub + Supabase Edge |
| Configuration | `.claude/`, `CLAUDE.md` in repository | GitHub |

## Recovery Procedures

### Scenario 1: Database corruption or data loss

1. Identify the point of failure from Supabase dashboard logs
2. Restore from the most recent clean backup via Supabase dashboard
3. Verify data integrity: check row counts, run RLS policy tests
4. Notify affected customers within 72 hours per GDPR Article 33

### Scenario 2: Application outage

1. Check Supabase status page for infrastructure issues
2. If application code issue: revert to last known good commit, redeploy
3. If Edge Function issue: redeploy from repository
4. Monitor recovery via Supabase dashboard

### Scenario 3: Accidental data deletion (single company)

1. Use company archive restore function (if archive exists)
2. Or restore from database backup and extract company data
3. Re-import using admin tools
4. Log restoration in GDPR audit log

### Scenario 4: Complete infrastructure failure

1. Provision new Supabase project in same region (eu-west-2)
2. Restore database from most recent backup
3. Redeploy application from GitHub repository
4. Update DNS to point to new instance
5. Verify all Edge Functions are deployed and operational
6. Estimated time: 2-4 hours

## Encryption

| Layer | Method | Key management |
|-------|--------|---------------|
| Data at rest | AES-256 | Managed by Supabase/AWS |
| Data in transit | TLS 1.2+ | Managed by Supabase |
| Authentication tokens | JWT (RS256) | Supabase Auth, JWT secret in environment |
| Xero OAuth state | HMAC-SHA256 signed | Application secret in environment |

## Monitoring

| What | How | Alert |
|------|-----|-------|
| Database health | Supabase dashboard | Email alerts on downtime |
| Edge Function errors | Supabase function logs | Manual review |
| Authentication failures | Supabase Auth logs | Manual review |
| Data retention compliance | pg_cron automated jobs | Runs daily, logs to gdpr_audit_logs |

## Testing

| Test | Frequency | Last tested |
|------|-----------|-------------|
| Company archive + restore | Per release | September 2026 |
| Database backup verification | Quarterly | — |
| Full recovery drill | Annually | — |

## Contact

- **Technical incidents**: support@inflowhr.com
- **Security incidents**: security@inflowhr.com
- **Data protection**: privacy@inflowhr.com
