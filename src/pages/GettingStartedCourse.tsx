import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useFeatures, type Features } from '../context/FeatureContext'
import { useAuth } from '../context/AuthContext'

const COURSE_ID = 'onb-getting-started'

interface FAQ {
  q: string
  a: string
}

interface FeatureSection {
  featureKey: keyof Features | null
  title: string
  icon: string
  faqs: FAQ[]
}

const SECTIONS: FeatureSection[] = [
  {
    featureKey: null,
    title: 'Getting Started',
    icon: '🏠',
    faqs: [
      { q: 'What is InflowHR?', a: 'InflowHR is your company\'s HR platform. It gives you access to leave requests, expenses, payslips, e-learning, a people directory and more — all in one place.' },
      { q: 'How do I log in?', a: 'Click "Sign in with Microsoft" on the login page. Your company email is linked to your account automatically via Microsoft Entra ID (SSO). No separate password is needed.' },
      { q: 'Where do I find my profile?', a: 'Open the People Directory from the main menu. Your profile card shows your role, department, contact details and photo. You can update your photo during initial setup.' },
      { q: 'What is the Dashboard?', a: 'The Dashboard is your landing page after login. It shows company announcements, quick-access cards for key features, and any outstanding tasks or notifications.' },
      { q: 'How do I change my notification preferences?', a: 'Go to Settings from the menu. You can toggle email and in-app notifications for leave approvals, expense updates, kudos and announcements.' },
      { q: 'Who do I contact for help?', a: 'Speak to your company admin or HR team. Their contact details are available in the People Directory — look for the Admin badge next to their name.' },
    ],
  },
  {
    featureKey: 'leave',
    title: 'Leave & Absence',
    icon: '🏖️',
    faqs: [
      { q: 'How do I request leave?', a: 'Go to Leave from the main menu, click "Request Leave", select the leave type (Annual, Sick, etc.), pick your dates, add an optional note and submit. Your manager will be notified.' },
      { q: 'How can I check my remaining leave balance?', a: 'Your leave balance is shown at the top of the Leave page. It displays your total allowance, days used, days pending approval, and remaining balance for the current year.' },
      { q: 'What leave types are available?', a: 'Common types include Annual Leave, Sick Leave, Jury Duty, Bereavement, Exam Leave, Carer\'s Leave and Lieu Days. Your company admin configures which types are available.' },
      { q: 'Can I cancel a leave request?', a: 'Yes — open the request from your leave history and click Cancel, provided it hasn\'t already been taken. Approved requests that haven\'t started can still be cancelled.' },
      { q: 'How do I know when my leave is approved?', a: 'You\'ll receive a notification when your manager approves or declines your request. The status also updates on the Leave page.' },
      { q: 'What happens if my leave request is declined?', a: 'You\'ll see a "Declined" status with any reason your manager provided. You can submit a new request for different dates.' },
    ],
  },
  {
    featureKey: 'expenses',
    title: 'Expenses',
    icon: '💷',
    faqs: [
      { q: 'How do I submit an expense claim?', a: 'Go to Expenses, click "New Claim", fill in the date, category, amount and description. Attach a photo of your receipt and submit for approval.' },
      { q: 'What categories of expenses can I claim?', a: 'Common categories include Travel, Accommodation, Meals, Client Entertainment, Office Supplies and Training. Your company may have additional categories.' },
      { q: 'Do I need to attach a receipt?', a: 'Yes — your company typically requires receipts for all expense claims. You can take a photo directly from your phone or upload a file.' },
      { q: 'How long does approval take?', a: 'Your manager receives a notification when you submit. Most companies process expenses within a few working days, but this depends on your company\'s policy.' },
      { q: 'Can I edit an expense after submitting?', a: 'You can edit an expense while it\'s still pending approval. Once approved or paid, it cannot be modified — contact your admin if corrections are needed.' },
      { q: 'How do I track my expense history?', a: 'The Expenses page shows all your claims with their status (Pending, Approved, Paid, Declined). Use the filters to search by date range or status.' },
    ],
  },
  {
    featureKey: 'payslips',
    title: 'Payroll & Payslips',
    icon: '💰',
    faqs: [
      { q: 'Where can I view my payslips?', a: 'Go to Payslips from the main menu. All your payslips are listed by month with gross pay, deductions (tax, NI, pension) and net pay clearly displayed. If you are paid weekly or bi-weekly, you will see multiple payslips per month, each with specific period dates.' },
      { q: 'Can I download my payslip?', a: 'Yes — click on any payslip to view the full breakdown, then use the Download button to save it as a PDF for your records.' },
      { q: 'What do the deductions mean?', a: 'Tax is your income tax (based on your tax code), NI is National Insurance, and Pension is your workplace pension contribution. Your payslip shows each amount separately.' },
      { q: 'I\'m a shift worker — how is my pay calculated?', a: 'Your gross pay is calculated from your approved check-in hours multiplied by your hourly rate. Overtime hours above your contracted weekly hours are paid at your overtime rate (typically 1.5x). You can see the hours breakdown on each payslip.' },
      { q: 'My payslip seems incorrect — what should I do?', a: 'Contact your company admin or payroll team immediately. They can review the calculation and issue a correction if needed.' },
      { q: 'When are payslips available?', a: 'Payslips are typically available a few days before or on your pay date. You\'ll receive a notification when a new payslip is ready to view. Draft payslips are hidden until your admin releases them.' },
    ],
  },
  {
    featureKey: 'kudos',
    title: 'Kudos & Recognition',
    icon: '⭐',
    faqs: [
      { q: 'What is Kudos?', a: 'Kudos lets you publicly recognise colleagues for great work. Send a kudos message to thank someone, celebrate an achievement or highlight a team effort.' },
      { q: 'How do I send a Kudos?', a: 'Go to Kudos from the main menu, click "Give Kudos", select the recipient, choose a category (e.g. Teamwork, Innovation, Going Above & Beyond), write your message and send.' },
      { q: 'Can everyone see my Kudos?', a: 'Yes — kudos are visible to everyone in your company. They appear in the Kudos feed and the recipient is notified.' },
      { q: 'Is there a limit to how many Kudos I can send?', a: 'There\'s no limit — recognise as many colleagues as you like! Frequent recognition builds a positive workplace culture.' },
    ],
  },
  {
    featureKey: 'elearning',
    title: 'E-Learning',
    icon: '📚',
    faqs: [
      { q: 'How do I access my courses?', a: 'Go to E-Learning from the main menu. You\'ll see all courses assigned to your company, filtered by category. Required courses are highlighted.' },
      { q: 'What types of courses are available?', a: 'Courses come in four types: Video (watch and learn), Article (read through sections), Quiz (test your knowledge with questions), and Policy (review company policies).' },
      { q: 'How do I complete a course?', a: 'Open the course, work through all the content, then click "Mark Complete". For quizzes, you must answer all questions correctly to pass.' },
      { q: 'Are some courses mandatory?', a: 'Yes — courses marked as "Required" must be completed, often by a specific deadline. Check the course card for any deadline shown.' },
      { q: 'Can I retake a quiz if I fail?', a: 'Yes — if you don\'t pass a quiz, click "Retry" to attempt it again. You can retake quizzes as many times as needed.' },
      { q: 'How is my progress tracked?', a: 'Your progress is shown on the E-Learning page with completion stats. Completed courses show a tick, and your overall completion percentage is displayed at the top.' },
    ],
  },
  {
    featureKey: 'timesheets',
    title: 'Timesheets',
    icon: '⏱️',
    faqs: [
      { q: 'How do I submit my timesheet?', a: 'Go to Timesheets, select the week, enter your hours for each day against the relevant project or task code, and submit for approval.' },
      { q: 'What is the deadline for submitting timesheets?', a: 'Timesheets should typically be submitted by the end of each week or as specified by your company policy. Late submissions may delay payroll processing.' },
      { q: 'Can I edit a submitted timesheet?', a: 'You can edit a timesheet while it\'s pending approval. Once approved, contact your manager to request a correction.' },
      { q: 'What are task codes?', a: 'Task codes categorise your time against specific projects, clients or activities. Your admin sets up the available codes for your company.' },
    ],
  },
  {
    featureKey: 'performance',
    title: 'Performance Reviews',
    icon: '📊',
    faqs: [
      { q: 'How do performance reviews work?', a: 'Your manager will schedule periodic reviews (quarterly, bi-annually or annually). You\'ll receive a notification to complete a self-assessment before the review meeting.' },
      { q: 'How do I complete my self-assessment?', a: 'Go to Performance from the main menu. Open the active review cycle, rate yourself against each objective, add comments about your achievements and areas for development, then submit.' },
      { q: 'Can I see feedback from my manager?', a: 'Yes — once your manager completes their assessment, both scores are visible side by side. This forms the basis of your review discussion.' },
      { q: 'How do I set objectives?', a: 'Objectives are typically set during your review meeting with your manager. They appear in the Performance section and can be tracked throughout the review period.' },
    ],
  },
  {
    featureKey: 'shifts',
    title: 'Shift Management',
    icon: '📅',
    faqs: [
      { q: 'Where can I see my shift schedule?', a: 'Go to Shifts from the main menu. Your upcoming shifts are shown in a calendar view with start time, end time and location.' },
      { q: 'Can I swap a shift with a colleague?', a: 'Yes — go to My Shifts and tap the swap icon on the shift you want to swap. Select an available colleague and their shift. They will receive a notification to accept or decline. Once they accept, your manager or admin reviews and approves the swap. Both shifts are updated automatically once approved.' },
      { q: 'How do I report that I can\'t make a shift?', a: 'Notify your manager as soon as possible. If the absence is due to illness, submit a sick leave request through the Leave feature.' },
    ],
  },
  {
    featureKey: 'benefits',
    title: 'Benefits',
    icon: '🎁',
    faqs: [
      { q: 'What benefits are available to me?', a: 'Go to Benefits from the main menu. Your company\'s benefits package is displayed with details of each benefit, eligibility and how to enrol.' },
      { q: 'How do I enrol in a benefit?', a: 'Open the benefit you\'re interested in and follow the enrolment steps. Some benefits have enrolment windows — check the dates shown.' },
      { q: 'Can I change my benefit selections?', a: 'Most benefits can be changed during the annual enrolment window or after a qualifying life event (marriage, birth of a child, etc.). Contact your admin for details.' },
    ],
  },
  {
    featureKey: 'space_booking',
    title: 'Space Booking',
    icon: '🏢',
    faqs: [
      { q: 'How do I book a desk or meeting room?', a: 'Go to Space Booking from the main menu. Select the date, choose an available space from the floor plan or list view, and confirm your booking.' },
      { q: 'Can I book a space for someone else?', a: 'Currently, bookings are made for your own use. If you need to arrange space for a visitor or team event, contact your office admin.' },
      { q: 'How do I cancel a booking?', a: 'Open your upcoming bookings and click Cancel on the booking you want to remove. The space will be released for others to book.' },
    ],
  },
  {
    featureKey: 'legal_timesheets',
    title: 'Legal Timesheets',
    icon: '⚖️',
    faqs: [
      { q: 'How are legal timesheets different from standard timesheets?', a: 'Legal timesheets record billable time against specific clients and matters using legal task codes (UTBMS). They support multiple rate cards and are used for client billing.' },
      { q: 'How do I record billable time?', a: 'Open Legal Timesheets, select the client and matter, choose the relevant task code, enter the time in hours (or use the timer), add a description of the work done, and save.' },
      { q: 'What are rate cards?', a: 'Rate cards define your hourly billing rate. Different rates may apply to different clients or matter types. Your admin configures the available rate cards.' },
    ],
  },
]

export default function GettingStartedCourse() {
  const navigate = useNavigate()
  const { companyUser, employeeId } = useAuth()
  const { companyFeatures } = useFeatures()
  const [expandedSection, setExpandedSection] = useState<number>(0)
  const [expandedFaqs, setExpandedFaqs] = useState<Set<string>>(new Set())
  const [completed, setCompleted] = useState(false)

  const visibleSections = SECTIONS.filter(
    s => s.featureKey === null || companyFeatures[s.featureKey]
  )

  const totalFaqs = visibleSections.reduce((sum, s) => sum + s.faqs.length, 0)
  const readFaqs = expandedFaqs.size
  const progressPct = totalFaqs > 0 ? Math.round((readFaqs / totalFaqs) * 100) : 0

  function toggleFaq(sectionIdx: number, faqIdx: number) {
    const key = `${sectionIdx}-${faqIdx}`
    setExpandedFaqs(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleComplete() {
    if (!companyUser?.company_id || !employeeId) return
    await supabase.from('elearning_completions').upsert({
      company_id: companyUser.company_id,
      employee_id: employeeId,
      course_id: COURSE_ID,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'company_id,employee_id,course_id' })
    setCompleted(true)
    setTimeout(() => navigate('/elearning'), 1500)
  }

  return (
    <div className="feature-page course-content-page">
      <header className="course-content-header">
        <button className="course-content-back" onClick={() => navigate('/elearning')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="course-content-header-info">
          <h1>Getting Started with InflowHR</h1>
          <div className="course-content-meta">
            <span className="course-content-type-badge" data-type="article">guide</span>
            <span className="course-content-duration">20 min</span>
          </div>
        </div>
      </header>

      {completed && (
        <div className="course-content-complete-overlay">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Well done!</span>
        </div>
      )}

      <div className="course-content-article" style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ background: 'var(--card-bg, #f5f7fa)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <p style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--text-secondary, #555)' }}>
            Welcome to InflowHR! This guide covers everything you need to know to get started. Browse the FAQs below — only features enabled for your company are shown.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border-color, #e0e0e0)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: '#1565c0', borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1565c0', minWidth: 45 }}>{readFaqs}/{totalFaqs}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {visibleSections.map((section, si) => (
            <div key={si} style={{ border: '1px solid var(--border-color, #e0e0e0)', borderRadius: 12, overflow: 'hidden' }}>
              <button
                onClick={() => setExpandedSection(expandedSection === si ? -1 : si)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '16px 20px', border: 'none', cursor: 'pointer',
                  background: expandedSection === si ? 'var(--card-bg, #f5f7fa)' : 'transparent',
                  fontWeight: 700, fontSize: 15, color: 'var(--text-primary, #222)',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 22 }}>{section.icon}</span>
                <span style={{ flex: 1 }}>{section.title}</span>
                <span style={{ fontSize: 12, color: '#888', fontWeight: 400 }}>
                  {section.faqs.filter((_, fi) => expandedFaqs.has(`${si}-${fi}`)).length}/{section.faqs.length}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: expandedSection === si ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {expandedSection === si && (
                <div style={{ borderTop: '1px solid var(--border-color, #e0e0e0)' }}>
                  {section.faqs.map((faq, fi) => {
                    const faqKey = `${si}-${fi}`
                    const isOpen = expandedFaqs.has(faqKey)
                    return (
                      <div key={fi} style={{ borderBottom: fi < section.faqs.length - 1 ? '1px solid var(--border-color, #eee)' : 'none' }}>
                        <button
                          onClick={() => toggleFaq(si, fi)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                            padding: '14px 20px', border: 'none', cursor: 'pointer',
                            background: isOpen ? 'var(--card-bg, #fafbfc)' : 'transparent',
                            fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #333)',
                            textAlign: 'left',
                          }}
                        >
                          <span style={{
                            width: 20, height: 20, borderRadius: '50%', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            background: isOpen ? '#1565c0' : 'var(--border-color, #e0e0e0)',
                            color: isOpen ? '#fff' : '#999', fontSize: 11, fontWeight: 700,
                          }}>
                            {isOpen ? '✓' : 'Q'}
                          </span>
                          <span style={{ flex: 1 }}>{faq.q}</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', flexShrink: 0 }}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {isOpen && (
                          <div style={{ padding: '0 20px 16px 50px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary, #555)' }}>
                            {faq.a}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <button className="course-content-complete-btn" onClick={handleComplete} style={{ padding: '14px 40px', fontSize: 16 }}>
            Mark Complete
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
