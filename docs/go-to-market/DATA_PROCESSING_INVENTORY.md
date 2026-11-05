# InflowHR — Personal Data Processing Inventory (ROPA)

**Last updated:** 05-11-2026
**Data controller:** The customer company (employer)
**Data processor:** CloudForge Software Services Ltd (trading as InflowHR)

Under GDPR Article 30, this Record of Processing Activities (ROPA) documents all personal data processed by InflowHR on behalf of customer companies.

## 1. Employee Core Data

| Field | Category | Lawful basis | Retention | Storage |
|-------|----------|-------------|-----------|---------|
| Full name | Identity | Art. 6(1)(b) contract | Duration of employment + 6 years | `employees` table |
| Email address | Contact | Art. 6(1)(b) contract | Duration of employment + 6 years | `employees` table |
| Phone number | Contact | Art. 6(1)(b) contract | Duration of employment + 6 years | `employees` table |
| Date of birth | Identity | Art. 6(1)(b) contract | Duration of employment + 6 years | `employees` table |
| Home address | Contact | Art. 6(1)(b) contract | Duration of employment + 6 years | `employees` table |
| Emergency contact | Contact | Art. 6(1)(f) legitimate interest (safety) | Duration of employment | `employees` table |
| National Insurance number | Financial | Art. 6(1)(c) legal obligation (PAYE) | Duration of employment + 6 years | `employees` table (masked in UI) |
| Bank details | Financial | Art. 6(1)(b) contract (payroll) | Duration of employment + 6 years | `employees` table (masked in UI) |
| Profile photo | Identity | Art. 6(1)(a) consent | Until withdrawn or employment ends | Supabase Storage |
| Employment category | Employment | Art. 6(1)(b) contract | Duration of employment + 6 years | `employees` table |
| Job title, department | Employment | Art. 6(1)(b) contract | Duration of employment + 6 years | `employees` table |
| Start date, end date | Employment | Art. 6(1)(b) contract | Duration of employment + 6 years | `employees` table |
| Salary, hourly rate | Financial | Art. 6(1)(b) contract | Duration of employment + 6 years | `employees` table |

## 2. Special Category Data (Article 9)

| Field | Category | Lawful basis | Additional safeguard | Storage |
|-------|----------|-------------|---------------------|---------|
| Religion/belief | Special category | Art. 9(2)(a) explicit consent | Consent recorded in `employee_consents`; only collected when employee opts in | `employees` table |
| Sick leave records | Health (indirect) | Art. 9(2)(b) employment obligations | Leave type visible only to manager and admin | `leave_requests` table |
| Fit notes / occupational health docs | Health | Art. 9(2)(b) employment obligations | Admin-only access; not visible to employees | `employee_documents` + Storage |
| Geolocation (check-in) | Location | Art. 6(1)(a) consent | Consent recorded in `employee_consents`; employee can decline | `check_in_records` table |

## 3. Leave & Absence

| Data type | Lawful basis | Retention | Storage |
|-----------|-------------|-----------|---------|
| Leave requests (type, dates, status) | Art. 6(1)(b) contract | Duration of employment + 6 years | `leave_requests` table |
| Leave allowances | Art. 6(1)(b) contract | Current year + 1 | `leave_allowances` table |
| Approval records | Art. 6(1)(b) contract | Duration of employment + 6 years | `workflow_tracker` table |

## 4. Payroll

| Data type | Lawful basis | Retention | Storage |
|-----------|-------------|-----------|---------|
| Payslip data (gross, net, tax, NI) | Art. 6(1)(c) legal obligation | 6 years after tax year end | `payslips` table |
| Payroll adjustments | Art. 6(1)(c) legal obligation | 6 years after tax year end | `payroll_adjustments` table |
| Benefits enrolment | Art. 6(1)(b) contract | Duration of employment + 6 years | `employee_benefits` table |

## 5. Timesheets & Shifts

| Data type | Lawful basis | Retention | Storage |
|-----------|-------------|-----------|---------|
| Shift assignments | Art. 6(1)(b) contract | Current year + 1 | `rota_shifts` table |
| Timesheet entries | Art. 6(1)(b) contract | 6 years (Working Time Regulations) | `timesheet_entries` table |
| Check-in records (time, location) | Art. 6(1)(a) consent / Art. 6(1)(b) | Duration of employment + 2 years | `check_in_records` table |

## 6. Documents

| Data type | Lawful basis | Retention | Storage |
|-----------|-------------|-----------|---------|
| Right to work documents | Art. 6(1)(c) legal obligation | Employment + 2 years (Home Office) | `employee_documents` + Storage |
| Contracts | Art. 6(1)(b) contract | Employment + 6 years | `employee_documents` + Storage |
| Disciplinary records | Art. 6(1)(f) legitimate interest | Employment + 6 years | `employee_documents` + Storage |

## 7. Expense Claims

| Data type | Lawful basis | Retention | Storage |
|-----------|-------------|-----------|---------|
| Claim details (title, amount, status) | Art. 6(1)(b) contract | 6 years (tax records) | `expense_claims` table |
| Receipt images | Art. 6(1)(b) contract | 6 years (tax records) | `receipts` bucket (Storage) |

## 8. Authentication & Access

| Data type | Lawful basis | Retention | Storage |
|-----------|-------------|-----------|---------|
| Auth user record (email, SSO token) | Art. 6(1)(b) contract | Duration of account | Supabase Auth |
| Last login timestamp | Art. 6(1)(f) legitimate interest (security) | Duration of account | `company_users` table |
| Audit log entries | Art. 6(1)(f) legitimate interest (security) | 2 years | `audit_log` table |

## 9. Surveys & Feedback

| Data type | Lawful basis | Retention | Storage |
|-----------|-------------|-----------|---------|
| Survey responses | Art. 6(1)(a) consent or Art. 6(1)(f) | As configured by company | `survey_responses` table |
| Anonymous survey responses | Art. 6(1)(f) legitimate interest | As configured by company | `survey_responses` table (no employee link) |

## 10. Guest Access

| Data type | Lawful basis | Retention | Storage |
|-----------|-------------|-----------|---------|
| Guest email, name | Art. 6(1)(b) contract | Access window + 30 days | `guest_users` table |
| Guest login timestamps | Art. 6(1)(f) legitimate interest | Access window + 30 days | `guest_users` table |

## Data Flows

### Internal flows
- Employee data → Manager (leave approvals, timesheets, directory)
- Employee data → Admin/HR (full access to company's employee records)
- Employee data → Super admin (cross-tenant, authorised by MSP agreement)

### External flows (subprocessor)
- Email addresses → Brevo (transactional notifications)
- Payroll data → Xero/Sage (where integration enabled)
- Auth tokens → Microsoft Entra ID (SSO authentication)
- Manager names + reference numbers → Slack/Teams (notifications, where enabled)
- File hashes → VirusTotal (document scanning, where enabled)
- Question text only → OpenAI (AI assistant, where enabled — no employee data)

### Data never shared externally
- Bank details, NI numbers, salaries, home addresses
- Health data, religion, disciplinary records
- Document file content (only SHA-256 hashes sent to VirusTotal)

## Data Subject Rights Implementation

| Right | Implementation | Location |
|-------|---------------|----------|
| Access (Art. 15) | "Download My Data" button in employee profile | `src/pages/MyProfile.tsx` |
| Rectification (Art. 16) | Employee self-service for contact details; admin for employment data | Various admin/employee pages |
| Erasure (Art. 17) | Permanent deletion via admin; cascade to all related tables and storage | `permanentlyDeleteEmployee()` |
| Portability (Art. 20) | Excel/ZIP export via "Download My Data" | `src/lib/employeeDataExport.ts` |
| Restriction (Art. 18) | Account deactivation (is_active = false) | Admin employee management |
| Objection (Art. 21) | Contact privacy@inflowhr.com | Privacy notice |

## Automated Retention Enforcement

InflowHR enforces data retention automatically via scheduled PostgreSQL cron jobs:
- Audit logs older than 2 years are purged
- Cancelled company data is archived and deleted after retention window
- Guest access records are purged 30 days after access window expires

## Contact

Data Protection Officer: privacy@inflowhr.com
