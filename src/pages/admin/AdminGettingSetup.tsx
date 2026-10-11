import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFeatures } from '../../context/FeatureContext'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

interface SetupStep {
  number: number
  title: string
  summary: string
  details: string
  icon: string
  page?: string
  optional?: boolean
  feature?: string
}

const SETUP_STEPS: SetupStep[] = [
  {
    number: 1,
    title: 'Import Your Employees',
    summary: 'Bulk upload employee records using the CSV template.',
    details: 'Navigate to the Onboard / Offboard page and download the CSV template file. Fill in your employee data following the column format provided, then upload the file to bulk import all records. Follow the onboarding wizard to review and activate each employee record. Once complete, all employees will be visible across the platform.',
    icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    page: '/admin/onboarding',
  },
  {
    number: 2,
    title: 'Review Employee Data',
    summary: 'Check and update all imported employee records.',
    details: 'On the Onboard / Offboard page, switch to the All Records view to see every employee. Review each record for accuracy — check names, job titles, departments, email addresses, start dates, and manager assignments. Update any fields that need correcting. This is your master employee directory and feeds into all other features.',
    icon: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M17 11a4 4 0 1 0 0-8"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
    page: '/admin/onboarding',
  },
  {
    number: 3,
    title: 'Configure Expense Settings',
    summary: 'Set up cost centres and expense types for your company.',
    details: 'Go to the Expenses page and select the Settings tab. Review the default cost centres and expense types — add any that are specific to your company and remove those that do not apply. These settings control the dropdown options your employees see when submitting expense claims and line items.',
    icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    page: '/admin/expenses',
    feature: 'expenses',
  },
  {
    number: 4,
    title: 'Set Up Leave Policies',
    summary: 'Configure leave allowances, weekend rules, and carryover.',
    details: 'On the Leave page, review and adjust the leave allowance deductions for each leave type. Decide whether your company counts weekends as working days (most do not). Set your carryover policy — whether unused leave days roll over to the next year and if so, how many. These settings apply to all employees and determine how leave balances are calculated.',
    icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    page: '/admin/leave',
    feature: 'leave',
  },
  {
    number: 5,
    title: 'Connect Payroll Provider',
    summary: 'Link Xero or Sage for payslips, or run payroll in standalone mode.',
    details: 'Navigate to Admin > Integrations and connect your payroll provider — Xero or Sage — using the Configure button on the relevant card. Both are included in the Core subscription at no extra cost. Once connected, the payroll wizard enters Connected mode automatically: it pushes overtime and variable hours to your provider and guides you through manual items. If you do not connect a provider, the wizard runs in Standalone mode and generates estimate payslips with approximate tax/NI (not HMRC-certified). See the User Guide Payroll section for the full connected vs standalone walkthrough.',
    icon: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
    page: '/admin/integrations',
    optional: true,
    feature: 'payslips',
  },
  {
    number: 6,
    title: 'Set Up E-Learning Courses',
    summary: 'Select core courses, assign departments, and create company-specific content.',
    details: 'On the E-Learning page, browse the catalogue of core courses available. Enable the courses you want your employees to complete, and for each course select which departments should be assigned. You can also create new company-specific courses tailored to your organisation — these appear alongside the core catalogue for your employees.',
    icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    page: '/admin/elearning',
    feature: 'elearning',
  },
  {
    number: 7,
    title: 'Create Company Announcements',
    summary: 'Post announcements and remove any default messages.',
    details: 'Navigate to the Announcements page to create a new announcement for your team. This is a good place to welcome employees to the platform, communicate company news, or share important updates. Review any default announcement messages that were pre-populated and delete those that are not relevant to your company.',
    icon: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    page: '/admin/announcements',
  },
  {
    number: 8,
    title: 'Familiarise with HR Tickets',
    summary: 'Understand the ticketing system for employee and service provider queries.',
    details: 'The HR Tickets page is where employees can raise queries and requests. As an admin, you can view and respond to all tickets. Note that only tickets directed to the service provider channel will be visible to the InflowHR support team — internal tickets stay within your company. Use this system for structured issue tracking and resolution.',
    icon: '<path d="M2 9V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2"/><path d="M22 15v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2"/><path d="M2 10a2 2 0 0 1 0 4"/><path d="M22 10a2 2 0 0 0 0 4"/>',
    page: '/admin/tickets',
  },
  {
    number: 9,
    title: 'Configure Timesheets & Check-In',
    summary: 'Enable time monitoring, create projects, and set up check-in locations.',
    details: 'On the Timesheets page, decide whether to enable time monitoring for your company. Create your company projects on the Customer Projects tab so employees can log time against them. If you want to use the check-in feature, enable it and then create your office locations by entering site coordinates — employees will use these to check in when arriving at work.',
    icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    page: '/admin/timesheets',
    optional: true,
    feature: 'timesheets',
  },
  {
    number: 10,
    title: 'Assign Managers & Build Org Chart',
    summary: 'Set up reporting lines to create your company organisation chart.',
    details: 'On the Performance page, review the Overview tab showing all employees and their current manager assignments. Use the Reassign button to set or change each employee\'s line manager. Once all reporting lines are in place, switch to the Org Chart tab to see the visual organisation diagram — this is automatically built from the manager assignments you configure here.',
    icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    page: '/admin/performance',
  },
  {
    number: 11,
    title: 'Set Up Legal Timesheets',
    summary: 'Configure clients, matters, and auto-rounding for legal time recording.',
    details: 'If legal timesheets are available on your subscription, navigate to the Legal Timesheets page. Add the clients and matters that your employees will book time against. On the Settings page, select the auto-rounding increment that applies to your company — this determines how recorded time is rounded up for billing purposes. This is a specialist feature for professional services firms.',
    icon: '<path d="M12 3v18"/><path d="M6 6l6 3 6-3"/><path d="M4 10l4 10h-8z" transform="translate(0)"/><path d="M16 10l4 10h-8z"/>',
    page: '/admin/legal-timesheets',
    optional: true,
    feature: 'legal_timesheets',
  },
  {
    number: 12,
    title: 'Configure Talent Intelligence',
    summary: 'Set up skill categories for employee skills passports.',
    details: 'If the Talent Intelligence feature is available, go to the Talent Intelligence page. You can seed the default skill categories or create your own custom categories relevant to your company. Remove any default categories that do not apply. Your employees will see these categories on their Skills Passport within their My Profile page, where they can self-assess and track their professional development.',
    icon: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/>',
    page: '/admin/talent-intelligence',
    optional: true,
    feature: 'skills_passport',
  },
  {
    number: 13,
    title: 'Manage Access & Permissions',
    summary: 'Grant admin roles and configure service provider access.',
    details: 'On the Access Management page, select key company personnel and grant them the appropriate admin role. This determines who can access the admin portal and what they can do. You also have the option to authorise the service provider (InflowHR) to access your HR data for support purposes using the Service Provider Support Access switch — this can be toggled on and off at any time.',
    icon: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    page: '/admin/access',
  },
  {
    number: 14,
    title: 'Review Billing & Charges',
    summary: 'View your subscription summary and monthly breakdown.',
    details: 'The Billing page provides a summary of your company\'s contracted services and any add-on features. Review the monthly breakdown of charges to ensure everything matches your agreement. This page is for reference — if you need to make changes to your subscription, contact the InflowHR team through the HR Tickets page.',
    icon: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    page: '/admin/billing',
  },
  {
    number: 15,
    title: 'Read the User Guides',
    summary: 'Detailed feature guides for end users and administrators.',
    details: 'The User Guides page contains comprehensive documentation covering every feature available to both employees and administrators. Refer to these guides for detailed walkthroughs, tips, and best practices. Share relevant sections with your team as they begin using the platform.',
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    page: '/admin/user-guides',
  },
]

const PHASE_MAP: { label: string; color: string; bg: string; range: [number, number] }[] = [
  { label: 'Foundation', color: '#2563eb', bg: '#dbeafe', range: [1, 2] },
  { label: 'Core Services', color: '#059669', bg: '#dcfce7', range: [3, 6] },
  { label: 'Communications', color: '#d97706', bg: '#fef3c7', range: [7, 8] },
  { label: 'Advanced Features', color: '#7c3aed', bg: '#ede9fe', range: [9, 12] },
  { label: 'Administration', color: '#dc2626', bg: '#fee2e2', range: [13, 15] },
]

function getPhase(stepNum: number) {
  return PHASE_MAP.find(p => stepNum >= p.range[0] && stepNum <= p.range[1])!
}

export default function AdminGettingSetup() {
  const navigate = useNavigate()
  const { features } = useFeatures()
  const { selectedCompanyId } = useAuth()
  const [expandedStep, setExpandedStep] = useState<number | null>(null)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())

  const loadProgress = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('companies')
      .select('setup_progress')
      .eq('id', selectedCompanyId)
      .single()
    if (data?.setup_progress?.completed) {
      setCompletedSteps(new Set(data.setup_progress.completed))
    }
  }, [selectedCompanyId])

  useEffect(() => { loadProgress() }, [loadProgress])

  async function toggleStep(stepNum: number) {
    const next = new Set(completedSteps)
    if (next.has(stepNum)) next.delete(stepNum)
    else next.add(stepNum)
    setCompletedSteps(next)
    if (selectedCompanyId) {
      await supabase
        .from('companies')
        .update({ setup_progress: { completed: Array.from(next) } })
        .eq('id', selectedCompanyId)
    }
  }

  const visibleSteps = SETUP_STEPS.filter(s => {
    if (!s.feature) return true
    return features[s.feature as keyof typeof features]
  })

  const totalSteps = visibleSteps.length
  const completedCount = visibleSteps.filter(s => completedSteps.has(s.number)).length
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0
  let currentPhaseLabel = ''

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Getting Setup</h1>
        <p className="admin-page-subtitle">Follow these steps to get your company ready to use InflowHR</p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #333)' }}>
            {completedCount} of {totalSteps} steps completed
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: progressPct === 100 ? '#16a34a' : 'var(--text, #666)' }}>
            {progressPct}%
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--border, #e5e7eb)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4,
            width: `${progressPct}%`,
            background: progressPct === 100 ? '#16a34a' : 'linear-gradient(90deg, #2563eb, #7c3aed)',
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* Phase legend */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {PHASE_MAP.map(p => (
          <span key={p.label} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600, padding: '4px 12px',
            borderRadius: 20, background: p.bg, color: p.color,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
            {p.label}
          </span>
        ))}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 600, padding: '4px 12px',
          borderRadius: 20, background: '#f3f4f6', color: '#6b7280',
          border: '1px dashed #d1d5db',
        }}>
          Optional
        </span>
      </div>

      {/* Visual stepped timeline */}
      <div style={{ position: 'relative', paddingLeft: 40 }}>
        {/* Vertical connector line */}
        <div style={{
          position: 'absolute', left: 19, top: 0, bottom: 0, width: 2,
          background: 'linear-gradient(to bottom, #2563eb, #059669, #d97706, #7c3aed, #dc2626)',
          borderRadius: 1,
        }} />

        {visibleSteps.map((step, idx) => {
          const phase = getPhase(step.number)
          const isExpanded = expandedStep === step.number
          const isLast = idx === totalSteps - 1

          let showPhaseHeader = false
          if (phase.label !== currentPhaseLabel) {
            currentPhaseLabel = phase.label
            showPhaseHeader = true
          }

          return (
            <div key={step.number}>
              {/* Phase header */}
              {showPhaseHeader && (
                <div style={{
                  position: 'relative',
                  marginBottom: 12,
                  marginTop: idx === 0 ? 0 : 28,
                  marginLeft: 20,
                }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: phase.color,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {phase.label}
                  </span>
                </div>
              )}

              {/* Step node */}
              <div
                style={{
                  position: 'relative',
                  marginBottom: isLast ? 0 : 6,
                  cursor: 'pointer',
                }}
                onClick={() => setExpandedStep(isExpanded ? null : step.number)}
              >
                {/* Node circle on the line */}
                <div style={{
                  position: 'absolute', left: -40, top: 14,
                  width: 40, height: 40, borderRadius: '50%',
                  background: isExpanded ? phase.color : 'var(--bg-card, #fff)',
                  border: `3px solid ${phase.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800,
                  color: isExpanded ? '#fff' : phase.color,
                  transition: 'all 0.25s ease',
                  zIndex: 2,
                  boxShadow: isExpanded ? `0 0 0 4px ${phase.bg}` : '0 1px 3px rgba(0,0,0,0.1)',
                }}>
                  {step.number}
                </div>

                {/* Card */}
                <div style={{
                  marginLeft: 20,
                  background: 'var(--bg-card, #fff)',
                  border: `1px solid ${isExpanded ? phase.color : 'var(--border, #e5e7eb)'}`,
                  borderRadius: 12,
                  overflow: 'hidden',
                  transition: 'border-color 0.25s ease, box-shadow 0.25s ease',
                  boxShadow: isExpanded ? `0 4px 12px ${phase.color}15` : '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  {/* Header row */}
                  <div style={{
                    padding: '14px 16px',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    {/* Completion checkbox */}
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleStep(step.number) }}
                      style={{
                        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                        border: completedSteps.has(step.number) ? 'none' : `2px solid var(--border, #d1d5db)`,
                        background: completedSteps.has(step.number) ? '#16a34a' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'all 0.2s ease',
                      }}
                    >
                      {completedSteps.has(step.number) && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                          stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>

                    {/* Step icon */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: phase.bg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke={phase.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        dangerouslySetInnerHTML={{ __html: step.icon }}
                      />
                    </div>

                    {/* Title + summary */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      }}>
                        <span style={{
                          fontWeight: 700, fontSize: 14,
                          color: 'var(--text, #1a1a1a)',
                        }}>
                          {step.title}
                        </span>
                        {step.optional && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 8px',
                            borderRadius: 4, background: '#f3f4f6', color: '#6b7280',
                            border: '1px dashed #d1d5db',
                          }}>
                            Optional
                          </span>
                        )}
                      </div>
                      <p style={{
                        margin: '2px 0 0', fontSize: 12, opacity: 0.6,
                        color: 'var(--text, #555)',
                      }}>
                        {step.summary}
                      </p>
                    </div>

                    {/* Expand chevron */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="var(--text, #999)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{
                        flexShrink: 0,
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.25s ease',
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>

                  {/* Expandable detail */}
                  {isExpanded && (
                    <div style={{
                      padding: '0 16px 16px',
                      borderTop: `1px solid var(--border, #e5e7eb)`,
                    }}>
                      <p style={{
                        margin: '14px 0 0', fontSize: 13, lineHeight: 1.7,
                        color: 'var(--text, #333)', opacity: 0.85,
                      }}>
                        {step.details}
                      </p>
                      {step.page && (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(step.page!) }}
                          style={{
                            marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '7px 16px', borderRadius: 8,
                            background: phase.color, color: '#fff',
                            border: 'none', fontSize: 12, fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
                          </svg>
                          Go to page
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* End node */}
        <div style={{ position: 'relative', marginTop: 12 }}>
          <div style={{
            position: 'absolute', left: -34, top: 0,
            width: 28, height: 28, borderRadius: '50%',
            background: '#16a34a', border: '3px solid #dcfce7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 2,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div style={{
            marginLeft: 20, padding: '6px 0',
            fontSize: 14, fontWeight: 700, color: '#16a34a',
          }}>
            You're all set!
          </div>
        </div>
      </div>
    </div>
  )
}
