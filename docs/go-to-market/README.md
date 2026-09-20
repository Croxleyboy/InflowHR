# InflowHR — Go-to-Market Documentation

All compliance, security, and customer-facing documents required for production launch.

---

## Compliance & Customer-Facing

| Document | Purpose | Audience |
|----------|---------|----------|
| [Service Level Agreement](SERVICE_LEVEL_AGREEMENT.md) | Uptime targets, support response times, service credits | Customers |
| [Incident Response Plan](INCIDENT_RESPONSE_PLAN.md) | Breach detection, containment, ICO notification, customer comms | Internal / Auditors |
| [Subprocessor List](SUBPROCESSORS.md) | GDPR Article 28 — third-party data processors | Customers / Auditors |
| [Backup & Recovery Plan](BACKUP_AND_RECOVERY.md) | RPO/RTO targets, encryption, recovery procedures | Customers / Auditors |
| [Change Log](CHANGELOG.md) | Auditable trail of security and compliance changes | Auditors |

## Security Audit Reports

| Report | Audit type | Findings | Status |
|--------|-----------|----------|--------|
| [Security Evidence Report](inflowhr-security-evidence.html) | Combined — all 3 audits | 31 total | 31 fixed |
| [Security Audit (Phase 1)](inflowhr-security-audit.html) | Manual code review (CodeRabbit) | 10 findings | All fixed |
| [CodeRabbit Action Plan](inflowhr-coderabbit-action-plan.html) | Automated audit (CodeRabbit) | 18 findings | All fixed |
| [Semgrep SAST Report](inflowhr-semgrep-scan-report.html) | Static analysis (Semgrep) | 3 findings | All fixed |

## Architecture & Planning

| Document | Purpose | Audience |
|----------|---------|----------|
| [Architecture Overview](inflowhr-architecture.html) | System architecture and component map | Internal / Auditors |
| [SMB Readiness Plan](inflowhr-smb-readiness-plan.html) | Launch readiness assessment and roadmap | Internal |

## AI-Assisted Development Framework

| Document | Location | Purpose |
|----------|----------|---------|
| [CLAUDE.md](../../CLAUDE.md) | Project root | AI guardrails — auto-loaded every session (naming, security, GDPR, forbidden patterns) |
| [SQL Rules](../../.claude/rules/sql.md) | `.claude/rules/` | Database-scoped rules — RLS templates, SECURITY DEFINER patterns, GDPR audit logging |
| [Settings](../../.claude/settings.json) | `.claude/` | Hard enforcement — tsc type checking after every TypeScript edit |
| [New Migration Skill](../../.claude/skills/new-migration.md) | `.claude/skills/` | `/new-migration` workflow template |
| [Development Standards](DEVELOPMENT_STANDARDS.md) | This folder | Human-readable security + GDPR checklists for contributors and auditors |

## Also in the repository

| Document | Location | Purpose |
|----------|----------|---------|
| [Vulnerability Disclosure](../../public/.well-known/security.txt) | `public/.well-known/security.txt` | Responsible disclosure policy (served at `/.well-known/security.txt`) |

## Still required (not code — legal/commercial)

| Document | Owner | Status |
|----------|-------|--------|
| Data Processing Agreement (DPA) | Solicitor | Not started |
| Public Privacy Policy (marketing site) | Solicitor | Not started |
| Cyber Insurance Certificate | Broker | Not started |
| Penetration Test Report | CREST-certified firm | Not started |
