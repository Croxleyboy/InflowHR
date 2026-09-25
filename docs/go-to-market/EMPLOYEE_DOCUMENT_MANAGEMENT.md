# InflowHR — Employee Document Management

**Last updated:** 25-09-2026

## Overview

InflowHR provides a secure, per-employee document management system within the admin Employee Records profile. Company administrators and HR managers can upload, view, download, and delete documents for each employee, organised into compliance-focused categories.

## Document Categories

| Category | Purpose | Retention guidance | Expiry tracking |
|----------|---------|-------------------|----------------|
| **Right to Work & Identity** | Passports, visas, BRP cards, national ID, right to work share codes | Duration of employment + 2 years (per Home Office guidance) | Yes — expiry date required, visual warnings at 30 days |
| **Contracts & Salary Terms** | Employment contracts, salary letters, contract amendments, offer letters | Duration of employment + 6 years (Limitation Act 1980) | No |
| **Absence & Fit Notes** | GP fit notes, occupational health reports, self-certification forms, return-to-work notes | Duration of employment + 3 years minimum | No |
| **Performance & Training** | Appraisal records, training certificates, CPD records, competency assessments | Duration of employment + 6 years | No |
| **Employee Relations & Disciplinary** | Investigation notes, disciplinary letters, grievance outcomes, appeal decisions | Duration of employment + 6 years (or spent per Rehabilitation of Offenders Act) | No |
| **Offboarding & Exit Records** | Resignation letters, exit interview notes, settlement agreements, P45 | 6 years from termination date | No |

## Accepted File Types

| Type | Extensions | Max size |
|------|-----------|----------|
| PDF documents | `.pdf` | 10 MB |
| Images | `.jpg`, `.jpeg`, `.png`, `.gif` | 10 MB |
| Word documents | `.doc`, `.docx` | 10 MB |
| Plain text | `.txt`, `.rtf` | 10 MB |
| OpenDocument | `.odt` | 10 MB |
| Spreadsheets | `.xls`, `.xlsx`, `.csv` | 10 MB |

Google Docs, Sheets, and Slides must be exported to one of the above formats before uploading (e.g. File > Download > PDF or .docx).

## Storage Architecture

### Where documents are stored

All employee documents are stored in **Supabase Storage** (backed by AWS S3 in the `eu-west-2` London region).

| Component | Location | Purpose |
|-----------|----------|---------|
| File storage | Supabase Storage bucket `employee-documents` | Binary file content |
| Metadata | PostgreSQL table `employee_documents` | File name, category, expiry date, scan status, upload history |
| Encryption at rest | AES-256 (AWS S3 default) | All files encrypted automatically |
| Encryption in transit | TLS 1.2+ | All uploads and downloads over HTTPS |

### Storage path structure

Files are stored at: `{company_id}/{employee_id}/{timestamp}_{sanitised_filename}`

This structure ensures:
- **Tenant isolation**: each company's files are in a separate folder
- **Employee scoping**: files are grouped per employee
- **Uniqueness**: timestamp prefix prevents filename collisions
- **Sanitisation**: special characters in filenames are replaced with underscores

### Access control

| Control | Implementation |
|---------|---------------|
| Bucket visibility | **Private** — no public URLs, no unauthenticated access |
| Row-Level Security (RLS) | All CRUD operations scoped to `company_id = get_my_company_id() OR is_super_admin()` |
| Storage policies | Folder-level check: `(storage.foldername(name))[1]::uuid = get_my_company_id()` |
| Authentication | Bearer token required for all operations |
| Who can access | Company admins and HR managers (via admin portal only) |

Employees cannot access, view, or download their own documents through the employee portal. Document access is restricted to administrative roles.

## Virus Scanning

### How it works

Every uploaded document is scanned for malware using the **VirusTotal API** before it can be downloaded.

| Step | What happens |
|------|-------------|
| 1. Upload | File uploaded to Supabase Storage, metadata record created with `scan_status: 'pending'` |
| 2. Trigger | Frontend calls the `scan-document` Edge Function asynchronously |
| 3. Scan | Edge Function downloads the file, submits to VirusTotal, polls for results (up to 60 seconds) |
| 4. Result | `scan_status` updated to `clean`, `infected`, `error`, `timeout`, or `skipped` |
| 5. Infected | If malware detected, file is **automatically deleted** from storage |

### Scan statuses

| Status | Meaning | User experience |
|--------|---------|----------------|
| `pending` | Awaiting scan | Badge: "Scan pending" (blue) |
| `scanning` | Scan in progress | Badge: "Scanning…" (blue) |
| `clean` | No threats detected | No badge shown (clean state is the default) |
| `infected` | Malware detected | Badge: "⚠ Malware detected" (red). File automatically removed from storage |
| `skipped` | No VirusTotal API key configured | Badge: "Scan skipped" (grey) |
| `error` | Scan failed | Badge: "Scan error" (amber) |
| `timeout` | Scan did not complete within 60 seconds | Badge: "Scan timeout" (amber) |

### VirusTotal API

- **Free tier**: 4 lookups/minute, 500/day, 1,000/month
- **Premium**: higher rate limits available at [virustotal.com](https://www.virustotal.com)
- **Configuration**: set `VIRUSTOTAL_API_KEY` as a Supabase Edge Function secret
- **If not configured**: documents are uploaded but scanning is skipped (status: `skipped`)
- **Data processing**: file content is sent to VirusTotal for analysis. VirusTotal's privacy policy applies. Files are not retained by VirusTotal on the free tier beyond analysis.

### Setting up virus scanning

```bash
# Set the VirusTotal API key as a Supabase secret
npx supabase secrets set VIRUSTOTAL_API_KEY=your_api_key_here

# Deploy the Edge Function
npx supabase functions deploy scan-document
```

## GDPR & Compliance

### Lawful basis

Employee documents are processed under **GDPR Article 6(1)(b)** (performance of a contract) and **Article 6(1)(c)** (legal obligation — e.g. right to work checks under Immigration, Asylum and Nationality Act 2006).

### Data subject rights

| Right | How addressed |
|-------|--------------|
| Access (Art. 15) | Documents included in employee data export (DSAR) |
| Erasure (Art. 17) | Documents deleted when employee record is permanently deleted |
| Portability (Art. 20) | Documents included in ZIP export via "Download My Data" |

### Retention

Documents follow the retention periods in the category table above. When a company account is cancelled and archived, all associated documents are included in the company archive ZIP and then deleted from active storage after the retention window.

### Audit trail

All document uploads, downloads, and deletions are tracked in the `employee_documents` table with timestamps and the uploading user's identity (`uploaded_by`, `uploaded_by_name`).

## UK Employment Law References

| Category | Legislation / Guidance |
|----------|----------------------|
| Right to Work | Immigration, Asylum and Nationality Act 2006; Home Office Right to Work Checks guidance |
| Contracts | Employment Rights Act 1996 |
| Absence records | Statutory Sick Pay regulations; Equality Act 2010 (reasonable adjustments) |
| Disciplinary | ACAS Code of Practice on Disciplinary and Grievance Procedures |
| Data retention | UK GDPR; Limitation Act 1980 (6-year limitation period for contract claims) |
| Payroll records | Income Tax (PAYE) Regulations 2003 (keep for 3 years after end of tax year) |

## Contact

For questions about document storage or compliance: privacy@inflowhr.com
