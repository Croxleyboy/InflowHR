import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'

type Tab = 'overview' | 'rights' | 'consents' | 'retention' | 'breach'

interface ConsentRow {
  id: number
  employee_id: string
  consent_type: string
  status: string
  granted_at: string | null
  withdrawn_at: string | null
  employees: { first_name: string; last_name: string } | null
}

function formatDateUK(dateStr: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB')
}

export default function AdminGDPR() {
  const { selectedCompanyId } = useAdminCompany()
  const [tab, setTab] = useState<Tab>('overview')

  // Overview stats
  const [employeeCount, setEmployeeCount] = useState(0)
  const [consentCount, setConsentCount] = useState(0)
  const [lastAuditDate, setLastAuditDate] = useState<string | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  // Consent records
  const [consents, setConsents] = useState<ConsentRow[]>([])
  const [consentsLoading, setConsentsLoading] = useState(false)
  const [consentFilter, setConsentFilter] = useState('')
  const [consentPage, setConsentPage] = useState(1)
  const CONSENT_PAGE_SIZE = 20

  useEffect(() => {
    if (!selectedCompanyId) return
    loadOverviewStats()
  }, [selectedCompanyId])

  useEffect(() => {
    if (tab === 'consents' && selectedCompanyId) {
      loadConsents()
    }
  }, [tab, selectedCompanyId, consentFilter])

  async function loadOverviewStats() {
    setStatsLoading(true)

    const [empRes, consentRes, auditRes] = await Promise.all([
      supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', selectedCompanyId),
      supabase
        .from('employee_consents')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'granted')
        .in('employee_id',
          (await supabase.from('employees').select('id').eq('company_id', selectedCompanyId)).data?.map(e => e.id) || []
        ),
      supabase
        .from('gdpr_audit_logs')
        .select('performed_at')
        .eq('company_id', selectedCompanyId)
        .order('performed_at', { ascending: false })
        .limit(1),
    ])

    setEmployeeCount(empRes.count || 0)
    setConsentCount(consentRes.count || 0)
    setLastAuditDate(auditRes.data?.[0]?.performed_at || null)
    setStatsLoading(false)
  }

  async function loadConsents() {
    setConsentsLoading(true)

    const empIds = (
      await supabase.from('employees').select('id').eq('company_id', selectedCompanyId)
    ).data?.map(e => e.id) || []

    if (empIds.length === 0) {
      setConsents([])
      setConsentsLoading(false)
      return
    }

    let query = supabase
      .from('employee_consents')
      .select('id, employee_id, consent_type, status, granted_at, withdrawn_at, employees(first_name, last_name)')
      .in('employee_id', empIds)
      .order('granted_at', { ascending: false })

    if (consentFilter) {
      query = query.eq('consent_type', consentFilter)
    }

    const { data } = await query
    setConsents((data as unknown as ConsentRow[]) || [])
    setConsentPage(1)
    setConsentsLoading(false)
  }

  const consentTotalPages = Math.max(1, Math.ceil(consents.length / CONSENT_PAGE_SIZE))
  const paginatedConsents = consents.slice(
    (consentPage - 1) * CONSENT_PAGE_SIZE,
    consentPage * CONSENT_PAGE_SIZE
  )

  const consentTypes = [...new Set(consents.map(c => c.consent_type))].sort()

  function renderPagination(
    currentPage: number,
    totalPages: number,
    totalItems: number,
    pageSize: number,
    setPage: (p: number) => void
  ) {
    if (totalPages <= 1) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          className="admin-btn-sm"
          onClick={() => setPage(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          style={{ padding: '6px 12px', fontSize: 13 }}
        >
          Previous
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
          <button
            key={page}
            onClick={() => setPage(page)}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: currentPage === page ? 700 : 400,
              background: currentPage === page ? '#1565c0' : '#f5f5f5',
              color: currentPage === page ? '#fff' : '#333',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {page}
          </button>
        ))}
        <button
          className="admin-btn-sm"
          onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          style={{ padding: '6px 12px', fontSize: 13 }}
        >
          Next
        </button>
        <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
          Showing {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, totalItems)} of {totalItems}
        </span>
      </div>
    )
  }

  // --- CHECKLIST ITEMS ---
  const checklist = [
    { label: 'Privacy notice published', done: true, link: '/privacy' },
    { label: 'Employee data export (DSAR) available', done: true },
    { label: 'Consent management active', done: true },
    { label: 'Data retention automated', done: true },
    { label: 'Audit logging enabled', done: true },
    { label: 'Anonymisation on termination available', done: true },
    { label: 'Breach response plan documented', done: true },
  ]

  // --- RIGHTS CARDS ---
  const rights = [
    {
      article: 'Art. 15',
      title: 'Right of Access',
      description: 'Employees can request a copy of all personal data held about them.',
      action: 'Employees download their data via Settings > Download My Data.',
    },
    {
      article: 'Art. 16',
      title: 'Right to Rectification',
      description: 'Employees can request correction of inaccurate personal data.',
      action: 'Employees contact their HR admin to correct data held in the system.',
    },
    {
      article: 'Art. 17',
      title: 'Right to Erasure',
      description: 'Individuals can request deletion of their personal data where there is no compelling reason for its continued processing.',
      action: 'Admin uses the anonymise_employee function upon termination to irreversibly anonymise personal data.',
    },
    {
      article: 'Art. 20',
      title: 'Right to Portability',
      description: 'Employees can obtain and reuse their personal data across different services.',
      action: 'Data is exported as Excel/ZIP format via the admin panel or employee self-service.',
    },
    {
      article: 'Art. 21',
      title: 'Right to Object',
      description: 'Employees can object to the processing of their personal data in certain circumstances.',
      action: 'Employees can withdraw consent via Settings at any time.',
    },
  ]

  // --- RETENTION TABLE ---
  const retentionRows = [
    { category: 'Payroll records', period: '7 years', basis: 'Finance Act / HMRC requirements' },
    { category: 'Working time records', period: '2 years', basis: 'Working Time Regulations 1998' },
    { category: 'Performance reviews', period: '5 years', basis: 'Legitimate interest for career development' },
    { category: 'Contact details', period: 'Employment + 1 year', basis: 'Contractual necessity, post-employment queries' },
    { category: 'Location / check-in data', period: '12 months', basis: 'Legitimate interest, time-limited relevance' },
    { category: 'Notifications', period: '90 days', basis: 'Operational, no long-term retention need' },
    { category: 'Frozen / cancelled accounts', period: 'Auto-purged daily', basis: 'Data minimisation principle' },
  ]

  // --- BREACH STEPS ---
  const breachSteps = [
    {
      step: 1,
      title: 'Identify and contain the breach',
      detail: 'Establish what data has been compromised, how the breach occurred, and take immediate steps to contain it (e.g. revoke access, disable accounts, isolate affected systems).',
    },
    {
      step: 2,
      title: 'Assess the risk to individuals',
      detail: 'Determine the likelihood and severity of the risk to individuals’ rights and freedoms. Consider the type of data, volume, and potential consequences.',
    },
    {
      step: 3,
      title: 'Notify the ICO within 72 hours if high risk',
      detail: 'If the breach is likely to result in a risk to people’s rights and freedoms, report it to the Information Commissioner’s Office within 72 hours of becoming aware.',
    },
    {
      step: 4,
      title: 'Notify affected data subjects without undue delay',
      detail: 'If the breach is likely to result in a high risk to individuals, inform those affected directly and without undue delay, explaining what happened and what they can do.',
    },
    {
      step: 5,
      title: 'Document the breach in the audit log',
      detail: 'Record the breach in the GDPR audit log including facts, effects, and remedial actions taken. This is required regardless of whether the ICO was notified.',
    },
    {
      step: 6,
      title: 'Review and improve security measures',
      detail: 'Conduct a post-incident review. Update security policies, access controls, and staff training to prevent recurrence.',
    },
  ]

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>GDPR &amp; Compliance</h1>
        <p style={{ color: '#666', marginTop: 4 }}>
          Data protection policies, subject rights, consent records, and breach response
        </p>
      </div>

      <div className="admin-sub-tabs" style={{ flexWrap: 'wrap' }}>
        <button className={`admin-sub-tab ${tab === 'overview' ? 'admin-sub-tab-active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`admin-sub-tab ${tab === 'rights' ? 'admin-sub-tab-active' : ''}`} onClick={() => setTab('rights')}>Data Subject Rights</button>
        <button className={`admin-sub-tab ${tab === 'consents' ? 'admin-sub-tab-active' : ''}`} onClick={() => setTab('consents')}>Consent Records</button>
        <button className={`admin-sub-tab ${tab === 'retention' ? 'admin-sub-tab-active' : ''}`} onClick={() => setTab('retention')}>Data Retention</button>
        <button className={`admin-sub-tab ${tab === 'breach' ? 'admin-sub-tab-active' : ''}`} onClick={() => setTab('breach')}>Breach Response</button>
      </div>

      {/* ---- OVERVIEW TAB ---- */}
      {tab === 'overview' && (
        <div className="admin-section">
          {statsLoading ? (
            <div className="admin-loading">Loading...</div>
          ) : (
            <>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
                <div style={{ background: '#f8f9fc', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 12, color: '#8b8fa3', fontWeight: 600, marginBottom: 4 }}>Total Employees</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e' }}>{employeeCount}</div>
                </div>
                <div style={{ background: '#f8f9fc', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 12, color: '#8b8fa3', fontWeight: 600, marginBottom: 4 }}>Active Consents</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#2e7d32' }}>{consentCount}</div>
                </div>
                <div style={{ background: '#f8f9fc', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 12, color: '#8b8fa3', fontWeight: 600, marginBottom: 4 }}>Last Audit Entry</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#1565c0' }}>
                    {lastAuditDate ? formatDateUK(lastAuditDate) : 'None'}
                  </div>
                </div>
                <div style={{ background: '#f8f9fc', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 12, color: '#8b8fa3', fontWeight: 600, marginBottom: 4 }}>Data Retention</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#2e7d32' }}>Active</div>
                </div>
              </div>

              {/* Your Responsibilities */}
              <div style={{ background: '#f8f9fc', borderRadius: 8, padding: 20, marginBottom: 24 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Your Responsibilities under UK GDPR</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                  <div style={{ background: '#fff', borderRadius: 6, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1565c0', marginBottom: 6 }}>InflowHR (Data Processor)</div>
                    <p style={{ fontSize: 13, color: '#444', margin: 0, lineHeight: 1.6 }}>
                      InflowHR processes employee data on your behalf under a Data Processing Agreement (DPA).
                      We implement technical and organisational measures to protect data, including encryption at rest
                      and in transit, audit logging, automated retention policies, and anonymisation tools.
                    </p>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 6, padding: 16, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e65100', marginBottom: 6 }}>Your Organisation (Data Controller)</div>
                    <p style={{ fontSize: 13, color: '#444', margin: 0, lineHeight: 1.6 }}>
                      As the data controller, you determine the purposes and means of processing employee personal data.
                      You are responsible for having a lawful basis for processing, responding to data subject requests,
                      maintaining a record of processing activities, and reporting breaches to the ICO when required.
                    </p>
                  </div>
                </div>
              </div>

              {/* Compliance checklist */}
              <div>
                <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Platform Compliance Checklist</h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {checklist.map((item, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      background: '#fff', borderRadius: 6, border: '1px solid #e5e7eb',
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={item.done ? '#2e7d32' : '#ccc'} strokeWidth="2.5">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                      <span style={{ fontSize: 13, color: '#333', flex: 1 }}>{item.label}</span>
                      {item.link && (
                        <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#1565c0' }}>
                          View
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- DATA SUBJECT RIGHTS TAB ---- */}
      {tab === 'rights' && (
        <div className="admin-section">
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Data Subject Rights</h3>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#8b8fa3' }}>
            How each UK GDPR right is fulfilled within InflowHR
          </p>
          <div style={{ display: 'grid', gap: 16 }}>
            {rights.map((r, i) => (
              <div key={i} style={{
                background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', padding: 20,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    background: '#e3f2fd', color: '#1565c0',
                  }}>
                    {r.article}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{r.title}</span>
                </div>
                <p style={{ fontSize: 13, color: '#555', margin: '0 0 8px', lineHeight: 1.6 }}>{r.description}</p>
                <div style={{
                  fontSize: 13, color: '#2e7d32', background: '#e8f5e9', padding: '8px 12px',
                  borderRadius: 6, display: 'flex', alignItems: 'flex-start', gap: 8,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" strokeWidth="2" style={{ marginTop: 1, flexShrink: 0 }}>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>{r.action}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- CONSENT RECORDS TAB ---- */}
      {tab === 'consents' && (
        <div className="admin-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Consent Records</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8b8fa3' }}>
                Employee consent statuses from the employee_consents table
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#8b8fa3' }}>Filter:</label>
              <select
                className="admin-input"
                style={{ minWidth: 160, fontSize: 13 }}
                value={consentFilter}
                onChange={e => { setConsentFilter(e.target.value); setConsentPage(1) }}
              >
                <option value="">All Types</option>
                {consentTypes.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {consentsLoading ? (
            <div className="admin-loading">Loading...</div>
          ) : consents.length === 0 ? (
            <div className="admin-empty" style={{ padding: 40 }}>No consent records found</div>
          ) : (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Employee Name</th>
                      <th>Consent Type</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedConsents.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontSize: 13 }}>
                          {c.employees ? `${c.employees.first_name} ${c.employees.last_name}` : 'Unknown'}
                        </td>
                        <td style={{ fontSize: 13 }}>{c.consent_type}</td>
                        <td>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                            background: c.status === 'granted' ? '#e8f5e9' : '#ffebee',
                            color: c.status === 'granted' ? '#2e7d32' : '#c62828',
                          }}>
                            {c.status === 'granted' ? 'Granted' : 'Withdrawn'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                          {c.status === 'granted'
                            ? formatDateUK(c.granted_at)
                            : formatDateUK(c.withdrawn_at || c.granted_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {renderPagination(consentPage, consentTotalPages, consents.length, CONSENT_PAGE_SIZE, setConsentPage)}
            </>
          )}
        </div>
      )}

      {/* ---- DATA RETENTION TAB ---- */}
      {tab === 'retention' && (
        <div className="admin-section">
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Data Retention Schedule</h3>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#8b8fa3' }}>
            Retention periods applied to different categories of employee data
          </p>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Data Category</th>
                  <th>Retention Period</th>
                  <th>Legal / Policy Basis</th>
                </tr>
              </thead>
              <tbody>
                {retentionRows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 13, fontWeight: 600 }}>{r.category}</td>
                    <td style={{ fontSize: 13 }}>{r.period}</td>
                    <td style={{ fontSize: 13, color: '#666' }}>{r.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{
            padding: '12px 16px', background: '#f8f9fc', borderRadius: 8, marginTop: 16,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b8fa3" strokeWidth="2" style={{ marginTop: 1, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <span style={{ fontSize: 12, color: '#8b8fa3', lineHeight: 1.6 }}>
              Automated data retention is handled by pg_cron purge jobs running in the database.
              Frozen and cancelled accounts are auto-purged daily. Review retention policies periodically
              to ensure they remain aligned with current legislation and business requirements.
            </span>
          </div>
        </div>
      )}

      {/* ---- BREACH RESPONSE TAB ---- */}
      {tab === 'breach' && (
        <div className="admin-section">
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Data Breach Response Plan</h3>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#8b8fa3' }}>
            Step-by-step procedure for handling a personal data breach under UK GDPR
          </p>

          <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
            {breachSteps.map(s => (
              <div key={s.step} style={{
                background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', padding: 16,
                display: 'flex', gap: 14, alignItems: 'flex-start',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', background: '#e3f2fd', color: '#1565c0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, flexShrink: 0,
                }}>
                  {s.step}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 4 }}>{s.title}</div>
                  <p style={{ fontSize: 13, color: '#555', margin: 0, lineHeight: 1.6 }}>{s.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ICO contact information */}
          <div style={{ background: '#fff3e0', borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#e65100' }}>
              Information Commissioner's Office (ICO)
            </h4>
            <div style={{ fontSize: 13, color: '#444', lineHeight: 1.8 }}>
              <div><strong>Website:</strong>{' '}
                <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" style={{ color: '#1565c0' }}>
                  ico.org.uk
                </a>
              </div>
              <div><strong>Breach reporting:</strong>{' '}
                <a href="https://ico.org.uk/make-a-complaint/data-protection-complaints/data-protection-complaints/" target="_blank" rel="noopener noreferrer" style={{ color: '#1565c0' }}>
                  Report a breach online
                </a>
              </div>
              <div><strong>Helpline:</strong> 0303 123 1113 (Monday to Friday, 9am to 5pm)</div>
              <div><strong>Reporting deadline:</strong> Within 72 hours of becoming aware of a qualifying breach</div>
            </div>
          </div>

          {/* DPO responsibilities */}
          <div style={{ background: '#f8f9fc', borderRadius: 8, padding: 20 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>
              Data Protection Officer (DPO) Responsibilities
            </h4>
            <ul style={{ fontSize: 13, color: '#444', margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
              <li>Act as the primary point of contact for the ICO and data subjects</li>
              <li>Monitor compliance with UK GDPR and internal data protection policies</li>
              <li>Advise on Data Protection Impact Assessments (DPIAs) where required</li>
              <li>Maintain the organisation's record of processing activities (Art. 30)</li>
              <li>Ensure breach notification procedures are followed within 72 hours</li>
              <li>Provide training and awareness to staff handling personal data</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
