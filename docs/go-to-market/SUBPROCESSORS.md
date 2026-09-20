# InflowHR — List of Subprocessors

**Last updated:** 19-09-2026

Under GDPR Article 28, InflowHR maintains this list of subprocessors that process personal data on behalf of our customers. We will notify customers of any changes to this list at least 30 days before a new subprocessor begins processing data.

## Infrastructure & Database

| Subprocessor | Purpose | Data processed | Location | DPA in place |
|-------------|---------|---------------|----------|-------------|
| **Supabase Inc.** | Database hosting, authentication, file storage, edge functions | All customer and employee data | AWS eu-west-2 (London) | Yes — Supabase DPA |
| **Amazon Web Services (AWS)** | Cloud infrastructure (via Supabase) | All data (encrypted at rest and in transit) | eu-west-2 (London) | Yes — via Supabase |

## Email

| Subprocessor | Purpose | Data processed | Location | DPA in place |
|-------------|---------|---------------|----------|-------------|
| **Brevo (Sendinblue)** | Transactional email delivery (notifications, reminders) | Employee email addresses, notification content | EU (France) | Yes — Brevo DPA |

## Integrations (customer-activated only)

These subprocessors are only engaged when a customer explicitly enables the integration.

| Subprocessor | Purpose | Data processed | Location | DPA in place |
|-------------|---------|---------------|----------|-------------|
| **Xero Ltd** | Payroll integration and payslip retrieval | Employee names, payroll data, payslip PDFs | AU/UK/Global | Yes — Xero DPA |
| **Microsoft (Azure AD)** | Single sign-on authentication | Email addresses, authentication tokens | EU/Global | Yes — Microsoft DPA |

## Embedded Services

| Subprocessor | Purpose | Data processed | Location | DPA in place |
|-------------|---------|---------------|----------|-------------|
| **Google (Maps Embed API)** | Location display for geolocation check-ins | Latitude/longitude coordinates (no PII sent) | Global | N/A — no personal data transferred |

## Services NOT used

InflowHR does **not** use:
- Third-party analytics or tracking (no Google Analytics, Mixpanel, etc.)
- Advertising networks
- Third-party error tracking (no Sentry, Bugsnag, etc.)
- CDN providers that inspect content

## Changes to this list

Customers will be notified by email at least 30 days before any new subprocessor is added. If a customer objects to a new subprocessor, they may terminate their agreement in accordance with the DPA.

## Contact

For questions about our subprocessors: privacy@inflowhr.com
