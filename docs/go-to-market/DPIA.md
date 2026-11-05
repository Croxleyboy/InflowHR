# InflowHR — Data Protection Impact Assessment (DPIA)

**Last updated:** 05-11-2026
**Assessment owner:** CloudForge Software Services Ltd
**Status:** Active — reviewed quarterly

## 1. Purpose of this Assessment

This DPIA is conducted under GDPR Article 35 to assess the risks of processing employee personal data through the InflowHR platform. It covers all processing activities described in the [Data Processing Inventory](DATA_PROCESSING_INVENTORY.md).

## 2. Description of Processing

### What is InflowHR?

InflowHR is a cloud-based HR management platform for UK SMBs. It processes employee personal data on behalf of employer companies (data controllers) as a data processor.

### Categories of data subjects

- Employees (full-time, part-time, zero-hours, contractors)
- Company administrators and HR managers
- Guest portal users (limited access, time-bound)
- Super administrators (platform management)

### Categories of personal data

- **Identity:** name, date of birth, profile photo
- **Contact:** email, phone, home address, emergency contacts
- **Financial:** bank details, NI number, salary, payslips, expenses
- **Employment:** job title, department, contract type, start/end dates
- **Health (special category):** sick leave records, fit notes, occupational health documents
- **Religion (special category):** where employee opts in, for holiday/dietary accommodations
- **Location:** geolocation check-in data (where employee consents)
- **Documents:** right-to-work, contracts, disciplinary records, training certificates

### Processing operations

| Operation | Purpose | Volume |
|-----------|---------|--------|
| Employee record management | Employment administration | All employees |
| Leave request and approval | Statutory and contractual leave | All employees |
| Payroll processing | Pay calculation and reporting | All employees |
| Document management | Compliance and record-keeping | Admin-uploaded documents |
| Shift scheduling and timesheets | Workforce management | Shift-based employees |
| Expense claim processing | Expense reimbursement | Submitting employees |
| Performance reviews | Talent management | Where company enables |
| AI-powered help desk | Employee self-service queries | Where company enables |

## 3. Necessity and Proportionality

### Lawful bases

| Basis | Applicable to |
|-------|--------------|
| Art. 6(1)(b) — contractual necessity | Core employment data, payroll, leave, shifts |
| Art. 6(1)(c) — legal obligation | Right-to-work checks, PAYE records, Working Time Regulations |
| Art. 6(1)(f) — legitimate interest | Audit logging, security monitoring, emergency contacts |
| Art. 6(1)(a) — consent | Religion, geolocation check-in, profile photo |
| Art. 9(2)(a) — explicit consent | Religion/belief data |
| Art. 9(2)(b) — employment obligations | Sick leave, fit notes |

### Data minimisation measures

- Slack/Teams notifications contain only manager names and reference numbers, never employee names or leave types
- AI features receive only question text and schema descriptions, never employee data
- VirusTotal receives only file hashes, never document content
- Bank details and NI numbers are masked in the admin UI
- Guest users see only the admin portal, not employee data
- Anonymous survey responses are decoupled from employee identity

### Storage limitation

- Automated retention cron jobs purge expired data
- Company cancellation triggers archive + deletion after retention window
- Guest access records are purged 30 days after access window
- Frontend error logs are purged after 90 days
- See [Data Processing Inventory](DATA_PROCESSING_INVENTORY.md) for per-field retention periods

## 4. Risk Assessment

### 4.1 Unauthorised access to employee data

| Aspect | Assessment |
|--------|-----------|
| **Likelihood** | Low |
| **Impact** | High |
| **Mitigations** | Row-Level Security (RLS) on all tables scoped to company_id; SSO enforcement for production users; role-based access control (admin/HR/employee); super admin access requires MSP pre-authorisation; CORS restricted to app.inflowhr.com |
| **Residual risk** | Low |

### 4.2 Cross-tenant data leakage

| Aspect | Assessment |
|--------|-----------|
| **Likelihood** | Very low |
| **Impact** | Critical |
| **Mitigations** | All queries scoped to `company_id = get_my_company_id()`; RLS enabled on all tables; storage policies enforce folder-level tenant isolation; anon role locked out of all tenant tables |
| **Residual risk** | Very low |

### 4.3 Special category data breach (health, religion)

| Aspect | Assessment |
|--------|-----------|
| **Likelihood** | Low |
| **Impact** | High |
| **Mitigations** | Sick leave types visible only to manager and admin; religion data collected only with explicit consent; fit notes accessible only via admin document management; Slack notifications never include leave type |
| **Residual risk** | Low |

### 4.4 Financial data exposure (bank details, NI numbers)

| Aspect | Assessment |
|--------|-----------|
| **Likelihood** | Low |
| **Impact** | High |
| **Mitigations** | Masked in admin UI (last 4 digits only); never included in CSV exports; salary RLS isolation; payroll data never sent to Slack/Teams; bank details never logged or cached |
| **Residual risk** | Low |

### 4.5 AI-related risks (data leakage to model provider)

| Aspect | Assessment |
|--------|-----------|
| **Likelihood** | Very low |
| **Impact** | Medium |
| **Mitigations** | AI receives only the question text and a database schema description; no employee names, ages, salaries or PII are ever passed to OpenAI; all data retrieval happens server-side after query generation; enterprise AI keys stored server-side only |
| **Residual risk** | Very low |

### 4.6 Document scanning (VirusTotal)

| Aspect | Assessment |
|--------|-----------|
| **Likelihood** | Very low |
| **Impact** | Medium |
| **Mitigations** | Hash-only lookup (SHA-256); file content never leaves InflowHR infrastructure; scanning is optional (skipped if no API key); only admins/HR can trigger scans |
| **Residual risk** | Very low |

### 4.7 Notification data leakage (Slack/Teams shared channels)

| Aspect | Assessment |
|--------|-----------|
| **Likelihood** | Low |
| **Impact** | Medium |
| **Mitigations** | GDPR-safe message format: only approver name (professional capacity) and system reference numbers; no employee names, leave types, or expense amounts in notifications |
| **Residual risk** | Very low |

### 4.8 Insider threat (admin/HR misuse)

| Aspect | Assessment |
|--------|-----------|
| **Likelihood** | Low |
| **Impact** | High |
| **Mitigations** | Audit logging on all sensitive operations (exports, deletions, access grants); DSAR export requires confirmation dialog; permanent deletion is irreversible and logged; super admin access requires MSP authorisation |
| **Residual risk** | Low |

## 5. Risk Matrix Summary

| Risk | Likelihood | Impact | Residual risk |
|------|-----------|--------|---------------|
| 4.1 Unauthorised access | Low | High | **Low** |
| 4.2 Cross-tenant leakage | Very low | Critical | **Very low** |
| 4.3 Special category breach | Low | High | **Low** |
| 4.4 Financial data exposure | Low | High | **Low** |
| 4.5 AI data leakage | Very low | Medium | **Very low** |
| 4.6 Document scanning | Very low | Medium | **Very low** |
| 4.7 Notification leakage | Low | Medium | **Very low** |
| 4.8 Insider threat | Low | High | **Low** |

## 6. Consultation

| Stakeholder | Consulted | Outcome |
|-------------|-----------|---------|
| Data subjects (employees) | Via privacy notice in-app | Notice published; consent mechanisms for religion and geolocation |
| Data protection officer | Yes | DPIA approved |
| ICO | Not required | Residual risks are within acceptable thresholds |

## 7. Decision

Processing may proceed. All identified risks have been mitigated to acceptable levels through technical and organisational measures. This DPIA will be reviewed:

- Quarterly (scheduled)
- When new data categories are introduced
- When new subprocessors are added
- When new AI features are deployed
- After any data breach or near-miss

## 8. Review History

| Date | Reviewer | Changes |
|------|----------|---------|
| 05-11-2026 | CloudForge Software Services | Initial DPIA covering all current processing activities |

## Contact

Data Protection Officer: privacy@inflowhr.com
