# InflowHR — Incident Response Plan

**Last updated:** 22-09-2026
**Document owner:** Andy Jones, Kumonix Ltd
**Review frequency:** Annually, or after any incident

---

## 1. Purpose

This plan defines how InflowHR identifies, responds to, and recovers from security incidents, with particular focus on personal data breaches affecting employee data under UK GDPR.

## 2. Scope

Covers all systems processing InflowHR customer data:
- Supabase database and authentication (AWS eu-west-2)
- Supabase Edge Functions
- Supabase Storage (employee receipts, documents)
- Brevo transactional email service
- Xero payroll integration (where enabled)
- Sage payroll integration (where enabled)
- Microsoft Teams integration (where enabled)
- Application frontend (app.inflowhr.com)

## 3. Incident Classification

| Severity | Definition | Examples | Response time |
|----------|-----------|----------|---------------|
| **Critical** | Confirmed data breach affecting personal data | Unauthorised access to employee records, data exfiltration, RLS bypass | Immediate (within 1 hour) |
| **High** | Security vulnerability with potential for data exposure | Authentication bypass, privilege escalation, exposed API endpoint | Within 4 hours |
| **Medium** | Security issue with limited exposure risk | Failed brute-force attempts, misconfigured policy, non-PII data exposure | Within 24 hours |
| **Low** | Security improvement identified | Missing security header, outdated dependency, code quality finding | Within 7 days |

## 4. Roles and Responsibilities

| Role | Person | Responsibilities |
|------|--------|-----------------|
| **Incident Lead** | Andy Jones | Overall coordination, ICO notification decision, customer communication |
| **Technical Lead** | Andy Jones / AI-assisted development | Investigation, containment, remediation |
| **Data Protection Contact** | privacy@inflowhr.com | DSAR handling, data subject notification |
| **Legal Counsel** | External solicitor (TBC) | ICO reporting advice, liability assessment |

_Note: As the team grows, these roles should be separated across individuals._

## 5. Incident Response Phases

### Phase 1: Identification (0-1 hours)

**Detection sources:**
- Supabase dashboard alerts (auth failures, unusual queries)
- Customer reports (via support@inflowhr.com)
- Security researcher reports (via security@inflowhr.com)
- GDPR audit log anomalies (gdpr_audit_logs table)
- Automated monitoring (pg_cron data retention jobs)

**Immediate actions:**
1. Confirm the incident is real (not a false positive)
2. Classify severity using the table above
3. Record the incident: date/time, how detected, what systems affected, what data potentially exposed
4. If Critical or High: proceed immediately to Phase 2

### Phase 2: Containment (1-4 hours)

**For authentication/access incidents:**
- Revoke compromised sessions: `DELETE FROM auth.sessions WHERE user_id = '<affected_user>'`
- Disable affected user accounts if necessary
- Rotate any compromised API keys or JWT secrets via Supabase dashboard

**For data exposure incidents:**
- Identify which companies and employees are affected using `gdpr_audit_logs`
- If a specific RLS policy is bypassed: deploy an emergency migration to fix the policy
- If an Edge Function is compromised: disable it via Supabase dashboard

**For infrastructure incidents:**
- Contact Supabase support (support@supabase.io) for infrastructure-level issues
- Enable Supabase's read-only mode if write access is compromised

**Preserve evidence:**
- Export relevant `gdpr_audit_logs` entries
- Export Supabase auth logs for the affected period
- Screenshot any relevant dashboard alerts
- Do NOT delete or modify logs

### Phase 3: Assessment (4-24 hours)

Determine the scope and impact:

1. **What data was affected?** Query `gdpr_audit_logs` for the incident period:
   ```sql
   SELECT * FROM gdpr_audit_logs
   WHERE created_at BETWEEN '<start>' AND '<end>'
   ORDER BY created_at;
   ```

2. **Which companies/employees?** Cross-reference with `employees` and `companies` tables

3. **What categories of personal data?** Check against PII field list:
   - Names, email addresses (basic personal data)
   - NI numbers, bank details, salary (special category / financial)
   - Health/disability data, religion, ethnicity (special category)
   - Geolocation check-in data

4. **Is this a notifiable breach?** A personal data breach must be reported to the ICO if it poses a risk to individuals' rights and freedoms. Employee financial data (salary, bank, NI) almost always meets this threshold.

### Phase 4: Notification (within 72 hours of awareness)

#### ICO Notification (if notifiable)

**Deadline: 72 hours from when you became aware of the breach.**

Report via: https://ico.org.uk/make-a-complaint/data-protection-complaints/data-protection-complaints/

Information required:
- Nature of the breach (what happened)
- Categories and approximate number of data subjects affected
- Categories of personal data records affected
- Likely consequences of the breach
- Measures taken or proposed to address the breach
- Contact details of the data protection contact (privacy@inflowhr.com)

If you don't have complete information within 72 hours, submit what you have and provide updates.

#### Customer Notification

Notify affected customers:
- **Within 24 hours of confirming a breach** affecting their employees
- Email to the company admin contact from support@inflowhr.com
- Include: what happened, what data was affected, what you're doing about it, what they should tell their employees

Template:
```
Subject: InflowHR Security Notification — Action Required

Dear [Company Admin],

We are writing to inform you of a security incident that may have affected
employee data held in your InflowHR account.

What happened: [Brief description]
When: [Date/time]
What data was affected: [Categories]
What we have done: [Containment and remediation steps]
What you should do: [Any actions needed, e.g., notify employees]

We have [reported/are reporting] this incident to the Information
Commissioner's Office as required under UK GDPR.

If you have questions, please contact us at support@inflowhr.com or
privacy@inflowhr.com.

Andy Jones
InflowHR
```

#### Data Subject Notification

If the breach poses a **high risk** to affected individuals (e.g., bank details or NI numbers exposed), notify the individuals directly or ask the company admin to do so via their internal channels.

### Phase 5: Remediation (1-7 days)

1. Deploy permanent fix (migration, code change, configuration)
2. Verify fix with targeted testing
3. Run security audit on related areas
4. Update `docs/CHANGELOG.md` with incident reference
5. Update this plan if the incident revealed a gap in the process

### Phase 6: Post-Incident Review (within 14 days)

Document:
- Timeline of events
- Root cause analysis
- What worked well in the response
- What could be improved
- Actions taken to prevent recurrence
- Whether this plan needs updating

Store the review in a private incident log (not in the public repository).

## 6. Contact Information

| Contact | Email | When to use |
|---------|-------|-------------|
| General support | support@inflowhr.com | Customer-reported issues |
| Security reports | security@inflowhr.com | Vulnerability reports from researchers |
| Data protection | privacy@inflowhr.com | DSAR requests, data breach queries |
| ICO reporting | https://ico.org.uk/make-a-complaint/ | Notifiable breach reporting |
| Supabase support | support@supabase.io | Infrastructure incidents |
| Legal counsel | TBC | Liability assessment, ICO reporting advice |

## 7. Testing

| Test | Frequency | Last tested |
|------|-----------|-------------|
| Tabletop exercise (walk through a scenario) | Annually | — |
| Contact list verification | Quarterly | — |
| Backup restore drill | Annually | — |
| Log review (gdpr_audit_logs anomalies) | Monthly | — |

## 8. Related Documents

- [Backup & Recovery Plan](BACKUP_AND_RECOVERY.md) — RPO/RTO targets and recovery procedures
- [Subprocessor List](SUBPROCESSORS.md) — third-party data processors
- [Development Standards](DEVELOPMENT_STANDARDS.md) — security and GDPR checklists
- [Security Evidence Report](inflowhr-security-evidence.html) — audit trail
- [Service Level Agreement](SERVICE_LEVEL_AGREEMENT.md) — uptime and support commitments
- [Vulnerability Disclosure](../../public/.well-known/security.txt) — responsible disclosure policy
