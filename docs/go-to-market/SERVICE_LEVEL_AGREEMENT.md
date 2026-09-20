# InflowHR — Service Level Agreement

**Last updated:** 20-09-2026
**Provider:** Kumonix Ltd (trading as InflowHR)

---

## 1. Service Description

InflowHR is a cloud-based HR management platform providing employee records, payroll integration, leave management, timesheets, shift scheduling, e-learning, asset management, and related HR functions. The service is accessed via https://app.inflowhr.com.

## 2. Service Availability

| Metric | Target |
|--------|--------|
| **Monthly uptime** | 99.9% |
| **Planned maintenance window** | Sundays 02:00–06:00 GMT (announced 48 hours in advance) |
| **Unplanned downtime resolution** | Critical: 4 hours / High: 8 hours / Medium: 24 hours |

### Uptime calculation

Uptime % = ((Total minutes in month − Downtime minutes) / Total minutes in month) × 100

**Excluded from downtime calculation:**
- Planned maintenance within the announced window
- Force majeure events (natural disasters, government actions)
- Customer's own network or browser issues
- Third-party service outages outside our control (Supabase infrastructure, Azure AD, Xero API)
- Issues caused by customer misuse or unauthorised modifications

## 3. Support

| Channel | Availability | Response time |
|---------|-------------|---------------|
| Email (support@inflowhr.com) | Monday–Friday, 09:00–17:30 GMT | Critical: 2 hours / Standard: 1 business day |
| Security (security@inflowhr.com) | 24/7 monitoring | Acknowledged within 48 hours |
| Data protection (privacy@inflowhr.com) | Monday–Friday | DSAR: within 30 days (GDPR requirement) |

### Issue classification

| Priority | Definition | Target resolution |
|----------|-----------|-------------------|
| **Critical** | Service completely unavailable, or confirmed data breach | 4 hours |
| **High** | Major feature unavailable (e.g., payroll, leave booking), data integrity issue | 8 hours |
| **Medium** | Feature partially degraded, workaround available | 2 business days |
| **Low** | Minor issue, cosmetic defect, feature request | 5 business days |

## 4. Data Protection

| Commitment | Detail |
|-----------|--------|
| **Data location** | AWS eu-west-2 (London) via Supabase |
| **Encryption at rest** | AES-256 |
| **Encryption in transit** | TLS 1.2+ |
| **Tenant isolation** | Row-level security on all database tables, scoped by company_id |
| **Backup frequency** | Daily automated, 7-day retention |
| **Recovery objectives** | RPO: 24 hours / RTO: 4 hours |
| **Data retention** | Configurable per company, automated enforcement via scheduled jobs |
| **GDPR compliance** | Audit logging, DSAR export, anonymisation, consent management |

## 5. Data Portability and Deletion

| Right | How exercised | Timeline |
|-------|--------------|----------|
| **Employee data export (DSAR)** | Self-service via employee profile, or admin request | Immediate (self-service) or within 30 days |
| **Company data export** | Admin-initiated full company archive (ZIP) | Immediate |
| **Account deletion** | Admin cancellation flow with 90-day frozen period | Data permanently deleted after 90 days |
| **Individual employee deletion** | Admin-initiated with cascade deletion + anonymisation | Immediate, with GDPR audit log |

## 6. Change Management

| Practice | Detail |
|----------|--------|
| **Code changes** | All changes via Git version control with pull request review |
| **Database migrations** | Sequential, numbered SQL migrations with RLS and audit logging |
| **Security testing** | AI-assisted guardrails on every change (type checking, security rules) |
| **Security audits** | 3 independent audits completed (September 2026), ongoing automated scanning |
| **Deployment** | Zero-downtime deployments via Supabase |

## 7. Service Credits

If monthly uptime falls below the target:

| Monthly uptime | Credit (% of monthly fee) |
|---------------|---------------------------|
| 99.0% – 99.9% | 10% |
| 95.0% – 99.0% | 25% |
| Below 95.0% | 50% |

Credits must be requested within 30 days of the affected month. Credits are applied to future invoices and do not exceed one month's fee.

## 8. Termination

| Scenario | Process |
|----------|---------|
| **Customer-initiated** | 30 days' notice. Company data archived and available for export during notice period. Data deleted 90 days after cancellation. |
| **Provider-initiated** | 90 days' notice. Full data export provided. |
| **For cause** (breach of terms) | Immediate suspension with 30 days to remedy. Data export available throughout. |

## 9. Limitations

This SLA does not constitute a warranty. InflowHR is provided "as is" to the extent permitted by law, with the commitments stated in this document. This SLA is subject to the terms of the Data Processing Agreement (DPA) between the parties.

## 10. Contact

| Purpose | Contact |
|---------|---------|
| Service issues | support@inflowhr.com |
| Security concerns | security@inflowhr.com |
| Data protection | privacy@inflowhr.com |
| Commercial | hello@kumonix.com |
