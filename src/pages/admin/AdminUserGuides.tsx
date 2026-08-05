import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

interface Feature {
  title: string
  purpose: string
  steps: string[]
  callout?: { type: 'tip' | 'note'; text: string }
}

interface GuideSection {
  icon: string
  title: string
  features: Feature[]
}

const EMPLOYEE_SECTIONS: GuideSection[] = [
  {
    icon: '🏖️', title: 'Leave Management',
    features: [
      { title: 'View Leave Balances', purpose: 'See remaining allowance for each leave type at a glance.', steps: ['Open Time Off from the bottom bar.', 'Balances are shown as cards at the top — total allowance, used, and remaining.'] },
      { title: 'Request Leave', purpose: 'Submit a new leave request for manager approval.', steps: ['Tap + Request Leave on the Time Off page.', 'Select the leave type, start and end dates, and add an optional note.', 'Tap Submit. Your manager receives a notification to approve or decline.'], callout: { type: 'note', text: 'Requests that exceed your remaining allowance will be flagged. Check your balance before submitting.' } },
      { title: 'Leave Calendar', purpose: 'See who in your team is off and when.', steps: ['From the Time Off page, tap Calendar.', 'Approved leave for your department is displayed on a shared calendar view.'] },
      { title: 'Leave History', purpose: 'Review all past and pending requests.', steps: ['From the Time Off page, tap History.', 'Filter by status (pending, approved, rejected) to find specific requests.'] },
      { title: '"I\'m Off" Quick Notification', purpose: 'Instantly notify your team you are away today.', steps: ['Tap the I\'m Off button on the Time Off page.', 'A notification is sent to your manager and team immediately.'] },
    ],
  },
  {
    icon: '💰', title: 'Expenses',
    features: [
      { title: 'Submit an Expense Claim', purpose: 'Claim back money you have spent on company business.', steps: ['Navigate to Home > Expenses and tap + New Claim.', 'Enter a title, amount, expense type, and an optional description.', 'Upload a receipt photo or PDF, then tap Submit.'], callout: { type: 'tip', text: 'Save claims as Draft if you need to add receipts later. Drafts are only visible to you.' } },
      { title: 'Track Claim Status', purpose: 'Follow your claim through the approval workflow.', steps: ['Your Expenses page lists all claims with a colour-coded status badge: Draft, Pending, Approved, or Rejected.', 'Tap any claim to view full details and the approval timeline.'] },
      { title: 'Expense Graph', purpose: 'See your spending trend over time.', steps: ['A visual graph at the top of the Expenses page summarises your claim amounts by month.'] },
    ],
  },
  {
    icon: '💷', title: 'Payslips',
    features: [
      { title: 'View Payslips', purpose: 'Access your monthly payslip breakdown.', steps: ['Navigate to Home > Payslips.', 'Payslips are listed by financial-year month. Tap any month to expand the full breakdown: gross pay, tax, National Insurance, pension, and net pay.'] },
      { title: 'Year-to-Date Summary', purpose: 'See cumulative earnings and deductions for the current financial year.', steps: ['The YTD summary is displayed at the top of the Payslips page.'] },
    ],
  },
  {
    icon: '⏱️', title: 'Timesheets',
    features: [
      { title: 'Submit a Timesheet', purpose: 'Log your working hours for a date range.', steps: ['Navigate to Home > Timesheets and tap + New Timesheet.', 'Set the start date, end date, hours worked, and an optional note.', 'Tap Submit. The system checks for time overlaps across shifts, legal timesheets, and other timesheet entries.'], callout: { type: 'note', text: 'Overlapping time entries are blocked. If you see a conflict warning, adjust your dates or times before resubmitting.' } },
      { title: 'Timesheet History', purpose: 'Review submitted and approved timesheets.', steps: ['Tap History on the Timesheets page.', 'Entries show the date range, hours, status, and approval timeline.'] },
    ],
  },
  {
    icon: '⚖️', title: 'Legal Timesheets',
    features: [
      { title: 'Log Time', purpose: 'Record billable time against a client and matter using one of three methods.', steps: ['Navigate to Home > Legal Timesheets and tap Log Time.', 'Select your client, matter, and activity code.', 'Choose an entry method: Timer (start/stop a live timer), Start/End (enter start and end times), or Manual (type the duration in hours directly).', 'Add a description and tap Submit.'], callout: { type: 'note', text: 'Daily time is capped at 10 hours across all time-tracking features. The system shows a breakdown of existing hours if you approach the limit.' } },
      { title: 'Active Timers', purpose: 'Manage running timers across multiple matters.', steps: ['Active timers appear at the top of the Legal Timesheets page.', 'Tap a timer to pause, resume, or stop and submit it.'] },
    ],
  },
  {
    icon: '🔄', title: 'Shifts & Rotas',
    features: [
      { title: 'View Your Schedule', purpose: 'See your upcoming shifts from published rotas.', steps: ['Navigate to Home > Shifts.', 'Your shifts are listed with the date, time, break, and shift name colour-coded.'] },
      { title: 'Shift Swaps', purpose: 'Request to swap a shift with a colleague.', steps: ['Tap Swap on the Shifts page.', 'Select the shift you want to swap and the colleague you want to swap with.', 'Your colleague receives a notification and can accept or decline. Both outcomes are tracked.'] },
      { title: 'Set Your Availability', purpose: 'Tell your manager which days and times you are available to work.', steps: ['Tap Availability on the Shifts page.', 'Toggle each day on or off and set preferred start/end times.', 'Tap Save. Managers see this when building rotas.'] },
    ],
  },
  {
    icon: '📚', title: 'E-Learning',
    features: [
      { title: 'Browse & Complete Courses', purpose: 'Work through training courses assigned to your company — videos, articles, quizzes, and policies.', steps: ['Navigate to Home > E-Learning.', 'Filter by All, Required, Recommended, or Bookmarked.', 'Filter further by category: Onboarding, Compliance, Policies, My Role, Growth, or Wellbeing.', 'Tap a course card to expand it, then tap Start Course.', 'Video courses play inline within the app. Quizzes must be passed to complete. Articles and policies are read-through.', 'Tap Mark Complete when finished.'] },
      { title: 'Progress Tracking', purpose: 'Track how many courses you have completed and time invested.', steps: ['The stats bar at the top shows completed count, total minutes, and required progress.', 'A "Continue Learning" banner appears if you have an in-progress course.'] },
      { title: 'Annual Renewals', purpose: 'Some compliance courses require annual re-completion.', steps: ['Courses due for renewal are flagged with a badge. Tap Renew Now to retake.'] },
    ],
  },
  {
    icon: '⭐', title: 'Kudos',
    features: [
      { title: 'Send Recognition', purpose: 'Publicly or privately recognise a colleague\'s work.', steps: ['Navigate to Home > Kudos and tap + Give Kudos.', 'Select the recipient, choose a category and badge, write your message, and decide whether to make it public.', 'Tap Send.'] },
      { title: 'View & Like Kudos', purpose: 'Browse the kudos feed and react to recognition posts.', steps: ['The Kudos page shows a scrollable feed. Tap the heart icon to like a post.'] },
    ],
  },
  {
    icon: '🎯', title: 'Performance & 1-to-1s',
    features: [
      { title: 'Schedule a 1-to-1', purpose: 'Book a one-to-one meeting with your manager or direct report.', steps: ['Navigate to Home > Performance and tap + New 1-to-1.', 'Select the participant, date, and time. Add agenda items if needed.', 'Tap Create.'], callout: { type: 'tip', text: 'This feature is visible to managers and employees with direct reports.' } },
      { title: 'Meeting History & Reports', purpose: 'Review past meetings and add notes or action items.', steps: ['Use the Upcoming, History, and Reports tabs to navigate between views.', 'Tap any meeting to open the detail view, add a summary, or update status.'] },
    ],
  },
  {
    icon: '🎁', title: 'Benefits',
    features: [
      { title: 'Browse & Enrol in Benefits', purpose: 'View available benefit plans and opt in or out.', steps: ['Navigate to Home > Benefits.', 'Each benefit shows a description, eligibility, cost, and lock period.', 'Tap Enrol to opt in. Some benefits have a lock period (monthly or yearly) during which you cannot unenrol.'] },
    ],
  },
  {
    icon: '🏢', title: 'Space Booking',
    features: [
      { title: 'Book a Desk or Meeting Room', purpose: 'Reserve workspace or meeting rooms at your office locations.', steps: ['Navigate to Home > Space Booking.', 'Select a location and floor. Available desks and rooms are listed with capacity and equipment tags.', 'Pick a date, select your space, choose a time slot, and tap Book.'], callout: { type: 'tip', text: 'Use the equipment filter to find rooms with specific kit (projector, whiteboard, video conferencing, etc.).' } },
      { title: 'Manage Your Bookings', purpose: 'View, edit, or cancel existing bookings.', steps: ['Your upcoming bookings appear on the Space Booking page. Tap a booking to view details or cancel.'] },
    ],
  },
  {
    icon: '👤', title: 'Profile & Directory',
    features: [
      { title: 'My Profile', purpose: 'View and update your personal details.', steps: ['Navigate to Home > My Profile.', 'View your job title, department, contract type, contact details, and emergency contacts.', 'Upload or change your avatar photo.'] },
      { title: 'Company Directory', purpose: 'Find colleagues by name, department, or job title.', steps: ['Tap Directory in the bottom navigation.', 'Search or scroll to find a colleague. Tap to view their profile card with contact details.'] },
    ],
  },
  {
    icon: '🔔', title: 'Notifications',
    features: [
      { title: 'Notification Tabs', purpose: 'Three tabs organise everything that needs your attention.', steps: ['Company — announcements and company-wide posts.', 'Actions — items requiring your action (leave approvals, expense approvals, timesheet reviews).', 'My Notifications — personal reminders: upcoming birthdays, shift reminders, booking confirmations, course deadlines, and more.'] },
      { title: 'Create a Post', purpose: 'Admins and authorised users can post company notifications.', steps: ['Tap + New Post on the Company tab.', 'Write your message, choose the audience, and publish.'] },
    ],
  },
  {
    icon: '⚙️', title: 'Settings',
    features: [
      { title: 'Personalise Your Dashboard', purpose: 'Show or hide feature cards on your home screen.', steps: ['Navigate to Settings from the bottom bar.', 'Toggle features on or off. Hidden features are still accessible via direct links but won\'t appear on your dashboard.'], callout: { type: 'note', text: 'You can only hide features your company has enabled. If a feature is not listed, your company admin has not activated it.' } },
      { title: 'Language & Theme', purpose: 'Switch between English and German, or toggle dark mode.', steps: ['Language and dark-mode toggles are at the top of the Settings page.', 'Changes apply immediately and are saved to your account.'] },
      { title: 'Access the Admin Portal', purpose: 'Company administrators can switch to the admin view.', steps: ['If your account has admin or HR role access, a Go to Admin Portal button appears at the bottom of Settings.'] },
    ],
  },
  {
    icon: '✅', title: 'Approvals (Managers)',
    features: [
      { title: 'Approve or Reject Requests', purpose: 'Managers can action leave, expense, and timesheet requests from the Actions tab.', steps: ['Open Notifications > Actions.', 'Tap a pending request to review the details.', 'Tap Approve or Reject. The employee is notified immediately.'], callout: { type: 'tip', text: 'You can also reach approval pages via the direct links sent in notification emails.' } },
    ],
  },
]

const ADMIN_SECTIONS: GuideSection[] = [
  {
    icon: '👥', title: 'Employee Management',
    features: [
      { title: 'View & Search Employees', purpose: 'Browse the full employee roster for your company.', steps: ['Navigate to Admin > Employees.', 'Search by name or email. Filter by department or status (active/inactive).'] },
      { title: 'Add an Employee', purpose: 'Register a new team member.', steps: ['Tap + Add Employee.', 'Enter first name, last name, email, job title, department, and contract type.', 'Set their role: Employee, Admin, or HR.', 'Tap Save. The employee can now sign in with their company Microsoft account.'] },
      { title: 'Edit & Deactivate', purpose: 'Update details or offboard an employee.', steps: ['Tap the edit icon on any employee row to modify their details.', 'Toggle Active off to deactivate. Deactivated employees cannot sign in but their data is retained.'] },
    ],
  },
  {
    icon: '🏖️', title: 'Leave Administration',
    features: [
      { title: 'Manage Leave Requests', purpose: 'Review, approve, or reject pending leave requests company-wide.', steps: ['Navigate to Admin > Leave.', 'All pending requests are listed with the employee name, leave type, dates, and status.', 'Tap to review, then Approve or Reject.'] },
      { title: 'Leave Types & Allowances', purpose: 'Configure the leave types available to employees and set default allowances.', steps: ['Manage leave types (Annual, Sick, Compassionate, etc.), their colours, and default allowances.', 'Per-employee allowance overrides can be set from the employee\'s profile.'] },
    ],
  },
  {
    icon: '💰', title: 'Expense Administration',
    features: [
      { title: 'Process Claims', purpose: 'Review and approve or reject employee expense claims.', steps: ['Navigate to Admin > Expenses.', 'Filter by status. Click any claim to review the details, attached receipts, and audit trail.', 'Approve or reject with an optional comment.'] },
    ],
  },
  {
    icon: '💷', title: 'Payroll',
    features: [
      { title: 'Manage Payslips', purpose: 'Create and publish monthly payslips for employees.', steps: ['Navigate to Admin > Payroll.', 'The Payslips tab lists all generated payslips. Create new payslips with gross pay, tax, NI, pension, and net pay details.'] },
      { title: 'Time Breakdown', purpose: 'View a consolidated report of employee working hours across timesheets, shifts, and legal timesheets.', steps: ['Switch to the Time Breakdown tab.', 'Set a date range and optionally filter by employee.', 'The summary table shows total hours per employee from each source. Expand a row for detailed entries.'], callout: { type: 'tip', text: 'Only columns for enabled time-tracking features are shown. If your company does not use shifts, that column is hidden automatically.' } },
    ],
  },
  {
    icon: '⏱️', title: 'Timesheet Administration',
    features: [
      { title: 'Review & Approve Timesheets', purpose: 'Process submitted timesheets from employees.', steps: ['Navigate to Admin > Timesheets.', 'Filter by status (pending, approved, rejected) and employee.', 'Tap any submission to review hours, date range, and notes. Approve or reject.'] },
    ],
  },
  {
    icon: '⚖️', title: 'Legal Timesheet Admin',
    features: [
      { title: 'Manage Clients, Matters & Activity Codes', purpose: 'Configure the reference data employees select when logging legal time.', steps: ['Navigate to Admin > Legal Timesheets.', 'Add or edit Clients, Matters (linked to a client), and Activity Codes.', 'Restrict which activity codes are available per matter using the allowed-codes setting.'] },
      { title: 'View Time Entries', purpose: 'Review billable time logged by all employees.', steps: ['The entries tab shows all time records with client, matter, employee, duration, and description.', 'Filter by date range, employee, or client.'] },
    ],
  },
  {
    icon: '🔄', title: 'Shifts & Rotas',
    features: [
      { title: 'Shift Templates', purpose: 'Define reusable shift patterns (e.g. "Early 06:00–14:00").', steps: ['Navigate to Admin > Shifts > Shift Templates.', 'Add templates with a name, start/end times, break duration, colour, department, and role.', 'Toggle templates active or inactive.'] },
      { title: 'Build Rotas', purpose: 'Create weekly rotas and assign employees to shifts.', steps: ['Switch to the Rotas & Scheduling tab.', 'Create a rota with a name and week start date. Assign employees to shift templates for each day.', 'The system checks for cross-system time overlaps (timesheets, legal timesheets). You can override conflicts if needed.', 'Publish the rota to make it visible to employees.'] },
      { title: 'Reports & Analytics', purpose: 'Company-specific shift metrics for the current financial year.', steps: ['Switch to the Reports & Analytics tab.', 'View KPIs: total shifts, people worked, total hours, average hours per person, and break time.', 'Charts include: top 5 workers, most-used shifts, day-of-week distribution, monthly hours, hours by department, and shift coverage.', 'Set the financial year start month (persists per company) at the top of the page.'] },
    ],
  },
  {
    icon: '📚', title: 'E-Learning',
    features: [
      { title: 'Company Course Visibility', purpose: 'Control which e-learning courses are available to your employees.', steps: ['Navigate to Admin > E-Learning.', 'The table lists all courses with a toggle switch. Enable or disable courses individually.', 'Use Enable All / Disable All for bulk changes.', 'Filter by category or industry to manage subsets quickly.'] },
    ],
  },
  {
    icon: '🚀', title: 'Onboarding',
    features: [
      { title: 'Dashboard', purpose: 'At-a-glance onboarding stats and pipeline.', steps: ['Navigate to Admin > Onboarding.', 'View total starters, in-progress, due to join, overdue, and completed counts.', 'The monthly chart shows starters per month for the current financial year.', 'The pipeline view shows how many starters are at each workflow stage.'] },
      { title: 'Create a New Starter', purpose: 'Add a new employee through the onboarding workflow.', steps: ['Switch to the New Starter tab.', 'Fill in basic details (name, email, job title, department, start date, contract type).', 'Optionally complete personal information, address, employment, emergency contact, and bank details.', 'Tap Create & Start Workflow to begin the 8-step onboarding process.'] },
      { title: 'Bulk Upload', purpose: 'Create multiple starters from a spreadsheet.', steps: ['Switch to the Bulk Upload tab.', 'Download the Excel template, fill it in, and upload.', 'Review the preview table, fix any validation errors, then confirm.'] },
      { title: 'Onboarding Workflow', purpose: 'Track each starter through 8 sequential steps.', steps: ['Steps: Create Details → Order Equipment → Organise First Meeting → Notify Manager → Plan First Day → Inform Starter → Create Accounts & Licences → Day 1 Access Verification.', 'Mark each step complete or skip if not applicable.', 'The final step (Day 1 Access) creates the employee record and activates their account.'] },
    ],
  },
  {
    icon: '⭐', title: 'Kudos Administration',
    features: [
      { title: 'Moderate & Review', purpose: 'Oversee recognition posts across the company.', steps: ['Navigate to Admin > Kudos.', 'View all kudos posts, search by employee, and delete inappropriate content if necessary.'] },
    ],
  },
  {
    icon: '📢', title: 'Announcements',
    features: [
      { title: 'Create & Manage Announcements', purpose: 'Publish company-wide announcements that appear on every employee\'s dashboard and notifications.', steps: ['Navigate to Admin > Announcements.', 'Tap + New Announcement, write a title and body, then publish.', 'The latest announcement appears as a banner on the employee dashboard.'] },
    ],
  },
  {
    icon: '🎫', title: 'HR Tickets',
    features: [
      { title: 'Handle Employee Tickets', purpose: 'Respond to and resolve HR queries raised by employees.', steps: ['Navigate to Admin > HR Tickets.', 'View open tickets, assign them, and update status as they are worked on.', 'Close tickets when resolved. Employees are notified of status changes.'] },
    ],
  },
  {
    icon: '🎁', title: 'Benefits Administration',
    features: [
      { title: 'Configure Benefit Plans', purpose: 'Set up the benefit options available to employees.', steps: ['Navigate to Admin > Benefits.', 'Add benefit types with title, description, cost, eligibility criteria, and lock periods.', 'Enable or disable benefit options as needed.'] },
    ],
  },
  {
    icon: '🎯', title: 'Performance',
    features: [
      { title: 'Manage Reviews & 1-to-1s', purpose: 'Oversee the performance review process company-wide.', steps: ['Navigate to Admin > Performance.', 'View all scheduled 1-to-1 meetings across the company.', 'Monitor completion rates and follow up on overdue reviews.'] },
    ],
  },
  {
    icon: '🏢', title: 'Space Management',
    features: [
      { title: 'Locations, Floors & Spaces', purpose: 'Define your office layout so employees can book desks and rooms.', steps: ['Navigate to Admin > Space Management.', 'Create Locations (offices), then add Floors within each location.', 'Add Spaces (desks or rooms) to each floor with capacity and status.'] },
      { title: 'Equipment Management', purpose: 'Tag meeting rooms with available equipment for filtering.', steps: ['Add equipment tags (projector, whiteboard, video conferencing, etc.) to rooms.', 'Employees can filter available rooms by equipment when booking.'] },
      { title: 'Occupancy Analytics', purpose: 'Understand how your spaces are being used.', steps: ['Switch to the Analytics tab for occupancy rates, peak days, and utilisation by location.'] },
    ],
  },
  {
    icon: '🔔', title: 'Notifications',
    features: [
      { title: 'Manage Notification Templates', purpose: 'Configure the notifications sent to employees for various events.', steps: ['Navigate to Admin > Notifications.', 'Review and customise notification content for system events.'] },
    ],
  },
  {
    icon: '💳', title: 'Billing',
    features: [
      { title: 'View Subscription Costs', purpose: 'See a breakdown of your company\'s InflowHR subscription.', steps: ['Navigate to Admin > Billing.', 'View enabled features, per-feature pricing, employee count, and total monthly cost.'], callout: { type: 'note', text: 'Feature activation and pricing changes are managed by the InflowHR platform team. Contact your account manager to adjust your subscription.' } },
    ],
  },
]

const SUPER_SECTIONS: GuideSection[] = [
  {
    icon: '🏢', title: 'Company Management',
    features: [
      { title: 'Create a Company', purpose: 'Register a new tenant on the platform.', steps: ['Navigate to Admin > Subscriptions > Companies.', 'Tap + Add Company.', 'Enter the company name and email domain (e.g. acme.co.uk).', 'Optionally upload a company logo.', 'Tap Save. The company is created with default feature settings.'] },
      { title: 'Edit & Deactivate Companies', purpose: 'Update company details or disable access.', steps: ['From the Companies tab, tap the edit icon on any company row.', 'Change the name, domain, or logo.', 'Toggle Active off to deactivate the entire company. All employees lose access immediately.', 'Toggle Login Disabled to temporarily block sign-in without deactivating.'], callout: { type: 'note', text: 'Deactivating a company does not delete any data. Reactivation restores full access.' } },
      { title: 'Company Admins', purpose: 'View and manage which employees have admin access within each company.', steps: ['Admin users are listed under each company\'s detail view.', 'To grant admin access, edit the employee\'s role in Admin > Employees.'] },
    ],
  },
  {
    icon: '📋', title: 'Subscriptions & Pricing',
    features: [
      { title: 'Global Pricing', purpose: 'Set the default per-user price for each feature module.', steps: ['Navigate to Admin > Subscriptions > Pricing.', 'Each feature is listed with its default monthly price. Edit the price inline and save.', 'Standard features (expenses, leave, profile, kudos) are included at no additional cost.', 'Add-on features (payroll, timesheets, shifts, e-learning, benefits, etc.) are priced per user per month.'] },
      { title: 'Feature Activation per Company', purpose: 'Enable or disable feature modules for individual companies.', steps: ['Switch to the Features tab.', 'Select a company from the dropdown.', 'Toggle features on or off. Optionally set a custom price that overrides the global default.', 'Changes take effect immediately — the company\'s sidebar and employee dashboard update on next page load.'], callout: { type: 'tip', text: 'Disabling a feature hides it from the company admin and all employees but does not delete any associated data.' } },
    ],
  },
  {
    icon: '📚', title: 'E-Learning Course Management',
    features: [
      { title: 'Create a Course', purpose: 'Add a new e-learning course to the platform catalogue.', steps: ['Navigate to Admin > E-Learning > Course Management.', 'Tap + New Course.', 'Fill in: title, description, category, type (video / article / quiz / policy), duration, industry, and optional fields (deadline, external video URL, tags).', 'Set whether the course is Required, has an Annual Reminder, and is Active.', 'Tap Create Course.'], callout: { type: 'tip', text: 'For video courses, paste a YouTube or Vimeo URL in the External URL field. The video embeds inline within the app automatically — YouTube watch links are converted to embed format.' } },
      { title: 'Edit & Delete Courses', purpose: 'Modify any field of an existing course or remove it entirely.', steps: ['Tap the edit icon on any course row to open the edit form.', 'Make changes and tap Save Changes.', 'To delete, tap the delete icon. This also removes the course from all company visibility settings.'] },
      { title: 'Company Visibility', purpose: 'Control which companies can see each course.', steps: ['Each course row has a Companies button showing "X/Y" (enabled/total).', 'Click to open a dropdown with checkboxes for every active company.', 'Tick or untick to grant or revoke visibility. Changes save instantly.'] },
    ],
  },
  {
    icon: '🔀', title: 'Cross-Company Operations',
    features: [
      { title: 'Switching Companies', purpose: 'View and manage any company\'s data from a single admin session.', steps: ['Use the company dropdown in the top bar to switch the active company.', 'All admin pages — employees, leave, expenses, payroll, etc. — immediately reflect the selected company\'s data.', 'The company selector is visible only to Super Admins.'] },
      { title: 'Feature Visibility', purpose: 'Super Admins see all sidebar modules regardless of the selected company\'s feature settings.', steps: ['Even if a feature is disabled for the selected company, it appears in the sidebar so you can access its admin page (which will show empty state or configuration options).'] },
    ],
  },
]

type Tab = 'employee' | 'admin' | 'super'

function SectionAccordion({ sections, openMap, onToggle }: { sections: GuideSection[]; openMap: Record<number, boolean>; onToggle: (i: number) => void }) {
  return (
    <>
      {sections.map((section, si) => (
        <div key={si} className={`admin-ug-section ${openMap[si] ? 'admin-ug-section-open' : ''}`}>
          <button className="admin-ug-section-toggle" onClick={() => onToggle(si)}>
            <span className="admin-ug-section-icon">{section.icon}</span>
            <span style={{ flex: 1, textAlign: 'left' }}>{section.title}</span>
            <svg className="admin-ug-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          {openMap[si] && (
            <div className="admin-ug-section-body">
              {section.features.map((feat, fi) => (
                <div key={fi} className="admin-ug-feature">
                  <h4>{feat.title}</h4>
                  <p className="admin-ug-purpose">{feat.purpose}</p>
                  <ul>
                    {feat.steps.map((step, sti) => <li key={sti}>{step}</li>)}
                  </ul>
                  {feat.callout && (
                    <div className={`admin-ug-callout admin-ug-callout-${feat.callout.type}`}>
                      <span>{feat.callout.type === 'tip' ? '💡' : '⚠️'}</span>
                      <span>{feat.callout.text}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

export default function AdminUserGuides() {
  const { isSuperAdmin } = useAuth()
  const [tab, setTab] = useState<Tab>('employee')
  const [empOpen, setEmpOpen] = useState<Record<number, boolean>>({ 0: true })
  const [admOpen, setAdmOpen] = useState<Record<number, boolean>>({ 0: true })
  const [supOpen, setSupOpen] = useState<Record<number, boolean>>({ 0: true })

  function toggle(setter: React.Dispatch<React.SetStateAction<Record<number, boolean>>>) {
    return (i: number) => setter(prev => ({ ...prev, [i]: !prev[i] }))
  }

  const INTRO: Record<Tab, { title: string; text: string; bullets: string[]; callout?: { type: 'tip' | 'note'; text: string } }> = {
    employee: {
      title: 'Getting Started',
      text: 'Sign in with your company Microsoft account. Your dashboard shows quick-access cards for every feature your company has enabled. Use the bottom navigation bar to jump between pages:',
      bullets: ['Home — your personalised dashboard', 'Time Off — leave balances and requests', 'Directory — search colleagues', 'Notifications — announcements, actions and reminders', 'Settings — language, theme and feature visibility'],
      callout: { type: 'tip', text: 'InflowHR is a progressive web app. On mobile, use your browser\'s "Add to Home Screen" option for a native app experience.' },
    },
    admin: {
      title: 'Getting Started',
      text: 'Access the Admin Portal from Settings > Go to Admin Portal, or navigate to /admin directly. The sidebar lists every module your company has enabled.',
      bullets: ['Dashboard — at-a-glance stats: total employees, pending leave, open expenses, tickets, and more.', 'Sidebar — modules are grouped and only shown if the feature is active for your company.'],
      callout: { type: 'tip', text: 'Use the Exit button in the top bar to return to the employee view at any time.' },
    },
    super: {
      title: 'Getting Started',
      text: 'As Super Admin you have full access to every company admin feature plus platform-level controls. Key differences from a standard Company Admin:',
      bullets: ['Company selector — a dropdown in the top bar lets you switch between all registered companies.', 'Subscriptions — manage pricing, feature activation, and company setup (sidebar item visible only to you).', 'E-Learning Course Management — full CRUD for courses and per-company visibility controls.'],
      callout: { type: 'note', text: 'All Company Admin features documented above apply to you as well. This section covers Super Admin–only capabilities.' },
    },
  }

  const intro = INTRO[tab]

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>User Guides</h2>
        <p>Reference documentation for all InflowHR features by role</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'employee' ? 'admin-tab-active' : ''}`} onClick={() => setTab('employee')}>Employee</button>
        <button className={`admin-tab ${tab === 'admin' ? 'admin-tab-active' : ''}`} onClick={() => setTab('admin')}>Company Admin</button>
        {isSuperAdmin && (
          <button className={`admin-tab ${tab === 'super' ? 'admin-tab-active' : ''}`} onClick={() => setTab('super')}>Super Admin</button>
        )}
      </div>

      <div className="admin-ug-intro">
        <h3>{intro.title}</h3>
        <p>{intro.text}</p>
        <ul>
          {intro.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
        {intro.callout && (
          <div className={`admin-ug-callout admin-ug-callout-${intro.callout.type}`}>
            <span>{intro.callout.type === 'tip' ? '💡' : '⚠️'}</span>
            <span>{intro.callout.text}</span>
          </div>
        )}
      </div>

      {tab === 'employee' && <SectionAccordion sections={EMPLOYEE_SECTIONS} openMap={empOpen} onToggle={toggle(setEmpOpen)} />}
      {tab === 'admin' && <SectionAccordion sections={ADMIN_SECTIONS} openMap={admOpen} onToggle={toggle(setAdmOpen)} />}
      {tab === 'super' && <SectionAccordion sections={SUPER_SECTIONS} openMap={supOpen} onToggle={toggle(setSupOpen)} />}
    </div>
  )
}
