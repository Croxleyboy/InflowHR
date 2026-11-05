# InflowHR — List of Subprocessors

**Last updated:** 05-11-2026

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
| **Sage Group plc** | Payroll integration and payslip upload | Employee names, payroll data, payslip PDFs | UK | Yes — Sage DPA |
| **Microsoft (Azure AD)** | Single sign-on authentication | Email addresses, authentication tokens | EU/Global | Yes — Microsoft DPA |
| **Microsoft (Teams)** | Teams presence and leave notifications (where enabled) | Employee names, email addresses, leave status | EU/Global | Yes — Microsoft DPA |
| **Slack Technologies (Salesforce)** | HR notifications to a company Slack channel (where enabled) | Manager names, request reference numbers only (no employee PII) | US/Global | Yes — Slack DPA (via Salesforce) |
| **Modulr Finance Ltd** | Employee payouts and payment processing (where enabled) | Employee names, bank details, payment amounts | UK | Yes — Modulr DPA |

## Hosting & CDN

| Subprocessor | Purpose | Data processed | Location | DPA in place |
|-------------|---------|---------------|----------|-------------|
| **Cloudflare Inc.** | CDN, DDoS protection, DNS and web application firewall for the InflowHR web application | IP addresses, HTTP headers (no employee PII stored) | Global (edge network) | Yes — Cloudflare DPA |

## Security Scanning

| Subprocessor | Purpose | Data processed | Location | DPA in place |
|-------------|---------|---------------|----------|-------------|
| **VirusTotal (Google/Chronicle)** | Malware hash-lookup for uploaded employee documents | File SHA-256 hash only (file content never leaves InflowHR infrastructure) | Global (US-based) | Yes — Google Cloud DPA (VirusTotal is a Chronicle/Google subsidiary) |

> **Note:** VirusTotal scanning is optional. If no API key is configured, documents are uploaded without scanning (scan status: `skipped`). Only the SHA-256 hash of the file is sent to VirusTotal for lookup — file content is never transmitted. See `docs/go-to-market/EMPLOYEE_DOCUMENT_MANAGEMENT.md` for full details.

## AI Services (customer-activated only)

These subprocessors are only engaged when a customer explicitly enables the AI feature.

| Subprocessor | Purpose | Data processed | Location | DPA in place |
|-------------|---------|---------------|----------|-------------|
| **OpenAI Inc.** | AI-powered employee help agent and enterprise AI assistant (where enabled) | Anonymised queries only — no employee names, IDs or PII are sent to OpenAI; the edge function formulates a database query from the user's question and executes it server-side | US | Yes — OpenAI DPA (Business terms) |

> **Note:** InflowHR's AI features use OpenAI solely to interpret natural-language questions and generate safe SQL queries. No employee data, names, ages, salaries or personal information is ever passed to OpenAI. The AI model receives only the question text and a schema description. All data retrieval happens server-side via Supabase after the query is generated. See the `ai-help-agent` and `enterprise-ai-agent` edge functions for implementation details.

## Embedded Services

| Subprocessor | Purpose | Data processed | Location | DPA in place |
|-------------|---------|---------------|----------|-------------|
| **Google (Maps Embed API)** | Location display for geolocation check-ins | Latitude/longitude coordinates (no PII sent) | Global | N/A — no personal data transferred |

## Services NOT used

InflowHR does **not** use:
- Third-party analytics or tracking (no Google Analytics, Mixpanel, etc.)
- Advertising networks
- CDN providers that inspect or store content (Cloudflare operates as a pass-through proxy)

## Changes to this list

Customers will be notified by email at least 30 days before any new subprocessor is added. If a customer objects to a new subprocessor, they may terminate their agreement in accordance with the DPA.

## Contact

For questions about our subprocessors: privacy@inflowhr.com
