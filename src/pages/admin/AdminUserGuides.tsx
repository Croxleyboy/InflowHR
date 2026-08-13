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
      { title: 'Deadlines & Days Remaining', purpose: 'See how long you have to complete each course based on your personal enrolment date.', steps: ['Each course card shows the number of days remaining until your deadline.', 'The deadline is calculated from the date you were enrolled plus the allowed completion period set by your admin.', 'Courses without a set completion period show no deadline.'], callout: { type: 'note', text: 'Deadlines are personal to you — they are based on when you were enrolled, not a fixed company-wide date.' } },
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
      { title: 'My Assets', purpose: 'View the company assets assigned to you.', steps: ['Navigate to My Profile and switch to the Job tab.', 'If your company has Asset Management enabled, a My Assets button appears next to the Department Members button.', 'Tap My Assets to open a popup listing all assets assigned to you — showing asset name and type.'], callout: { type: 'note', text: 'This button only appears if your company admin has enabled the Asset Management feature.' } },
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
    icon: '📊', title: 'Dashboard',
    features: [
      { title: 'Admin Dashboard Overview', purpose: 'At-a-glance summary of all HR activity across your company, accessible from the Admin sidebar.', steps: ['Navigate to Admin > Dashboard (the default landing page when entering the Admin Portal).', 'Stat cards show: Total Employees, New Onboarders, Benefits Enrolled, Shifts & Rotas, Legal Timesheets, Performance 1:1s, Space Bookings, Announcements, Tickets Raised, Pending Expenses, Pending Leave, and Kudos Given.', 'Click any stat card to jump directly to the relevant admin page.'] },
      { title: 'Expense Export Warning', purpose: 'An orange warning banner appears when expense exports are overdue.', steps: ['If no expense export has been run in 25+ days (or ever), a warning banner appears above the stat cards.', 'Click the banner to navigate directly to Admin > Expenses > Exports tab.'], callout: { type: 'note', text: 'This warning ensures company admins stay on top of regular expense processing. It is visible to all admins.' } },
    ],
  },
  {
    icon: '👥', title: 'Employees',
    features: [
      { title: 'View & Search Employees', purpose: 'Browse and filter the full employee roster for your company.', steps: ['Navigate to Admin > Employees from the sidebar.', 'Use the search bar to find employees by name or email.', 'Filter by department using the dropdown, or toggle between active and inactive employees.', 'Click any employee row to expand their full profile — job title, department, contract type, contact details, address, and emergency contacts.'] },
      { title: 'Add an Employee', purpose: 'Manually register a new team member who can then sign in to the HR app.', steps: ['Click + Add Employee at the top of the page.', 'Enter first name, last name, email, job title, department, and contract type.', 'Set their role: Employee, Admin, or HR.', 'Click Save. The employee can now sign in with their company Microsoft account and the HR app will be available to them.'] },
      { title: 'Edit Employee Details', purpose: 'Update any employee\'s profile information.', steps: ['Click the edit icon on any employee row to open inline editing.', 'Modify name, email, job title, department, contract type, or role.', 'Upload or change the employee\'s profile photo.', 'Save changes — updates are reflected in the employee\'s HR app immediately.'] },
      { title: 'Deactivate or Delete', purpose: 'Remove access or permanently delete an employee record.', steps: ['Toggle Active off to deactivate — the employee cannot sign in but all their data (leave, expenses, timesheets, etc.) is retained.', 'Click the delete icon to permanently remove the employee and cascade-delete all associated records.'], callout: { type: 'note', text: 'Deactivation is reversible; deletion is permanent. Use the Offboarding workflow (Admin > Onboard / Offboard) for a structured leaver process with a 30-day freeze period.' } },
    ],
  },
  {
    icon: '🏖️', title: 'Leave',
    features: [
      { title: 'Approve or Decline Leave Requests', purpose: 'Process all pending leave requests submitted by employees in the HR app.', steps: ['Navigate to Admin > Leave from the sidebar.', 'All pending requests are listed with the employee name, leave type, dates, and current status.', 'Click Approve or Decline on each request. The employee is notified immediately in their HR app.'] },
      { title: 'Configure Leave Types', purpose: 'Control which leave types are available to employees and whether they deduct from allowance.', steps: ['Scroll to the Leave Type Settings section on the same page.', 'Toggle "Deducts from Allowance" on or off for each type (e.g. Sick Leave typically does not deduct, Annual Leave does).', 'These settings apply company-wide — employees see the updated leave types immediately when requesting leave in the HR app.'], callout: { type: 'tip', text: 'Per-employee allowance overrides (e.g. giving one person extra annual leave) can be set from their individual profile in Admin > Employees.' } },
      { title: 'Configure Weekend Settings', purpose: 'Define which days are treated as weekends for leave calculations.', steps: ['Use the Weekend Settings section to configure which days count as non-working days.', 'This affects how leave duration is calculated when employees submit requests in the HR app.'] },
      { title: 'Leave Analytics', purpose: 'View leave trends across the company.', steps: ['A stacked bar chart at the bottom shows approved leave by month broken down by leave type for the current financial year.'] },
    ],
  },
  {
    icon: '💰', title: 'Expenses',
    features: [
      { title: 'Process Expense Claims', purpose: 'Review, approve, or reject expense claims submitted by employees through the HR app.', steps: ['Navigate to Admin > Expenses from the sidebar.', 'The Claims tab lists all submitted claims with employee name, amount, type, and status.', 'Filter by status (Pending, Approved, Rejected) to focus on items needing action.', 'Click any claim to view full details, attached receipt images/PDFs, and the audit trail.', 'Click Approve or Reject with an optional comment. The employee sees the updated status in their HR app.'] },
      { title: 'Export Expenses', purpose: 'Download all pending and approved expense claims from the last 30 days as a zip file with CSV summary and receipt attachments.', steps: ['Click the Export Expenses button (available on both the Claims tab and the Exports tab).', 'A zip file is generated containing a CSV of all claim line items and a receipts folder with all uploaded receipt files.', 'The zip downloads automatically with a date-stamped filename (e.g. Expenses_12-08-2026.zip).'], callout: { type: 'tip', text: 'The export covers the last 30 days of pending and approved claims for your company only. Run exports regularly to stay on top of expense processing.' } },
      { title: 'Export History', purpose: 'Track when expense exports were last run and by whom.', steps: ['Switch to the Exports tab.', 'The table lists each export with the date/time, who ran it, and the zip filename.', 'Only one export record is kept per person per day — running the export multiple times on the same day updates the existing record.'] },
      { title: 'Export Warning', purpose: 'Automatic alert when expenses have not been exported for 25 or more days.', steps: ['An orange warning banner appears on the Admin Dashboard and the Expense Management page when the last export is 25+ days old or no export has ever been run.', 'Click the banner to go directly to the Exports tab and run an export.'], callout: { type: 'note', text: 'The warning is visible to all company admins to encourage regular expense processing.' } },
    ],
  },
  {
    icon: '💷', title: 'Payroll',
    features: [
      { title: 'Manage Payslips', purpose: 'Create and publish monthly payslips that employees view in their HR app under Payslips.', steps: ['Navigate to Admin > Payroll from the sidebar.', 'The Payslips tab lists all generated payslips by employee and month.', 'Create a new payslip by entering gross pay, tax, National Insurance, pension deductions, and net pay.', 'Published payslips appear immediately in the employee\'s HR app under their Payslips page.'] },
      { title: 'Time Breakdown Report', purpose: 'View a consolidated report of employee working hours across all time-tracking features to inform payroll calculations.', steps: ['Switch to the Time Breakdown tab.', 'Set a date range and optionally filter by employee.', 'The summary table shows total hours per employee from each source: Timesheets, Shifts, and Legal Timesheets.', 'Expand any row to see the individual time entries that make up the total.'], callout: { type: 'tip', text: 'Only columns for enabled time-tracking features are shown. If your company does not use shifts, that column is hidden automatically.' } },
    ],
  },
  {
    icon: '⏱️', title: 'Timesheets',
    features: [
      { title: 'Review & Approve Timesheets', purpose: 'Process timesheet submissions from employees. Approved entries feed into the Payroll Time Breakdown report.', steps: ['Navigate to Admin > Timesheets from the sidebar.', 'The Entries tab lists all submitted timesheets with employee name, date range, hours, and status.', 'Filter by status (Pending, Approved, Rejected) and by employee.', 'Click any entry to review hours, dates, and notes. Use inline editing to adjust hours, status, or project assignment.', 'Approve or reject — the employee sees the updated status in their HR app.'] },
      { title: 'Customer Projects', purpose: 'Configure projects that employees can assign their timesheet entries to.', steps: ['Switch to the Customer Projects tab.', 'Add, edit, or archive projects. Each project has a name and status.', 'Employees see active projects as options when submitting timesheets in the HR app.'] },
      { title: 'Project Timeline', purpose: 'Visualise timesheet entries across projects over time.', steps: ['Switch to the Project Timeline tab for a timeline view of hours logged against each project.'] },
    ],
  },
  {
    icon: '⚖️', title: 'Legal Timesheets',
    features: [
      { title: 'Overview Dashboard', purpose: 'At-a-glance KPIs for legal time across the company.', steps: ['Navigate to Admin > Legal Timesheets from the sidebar.', 'The Overview tab shows: Billable This Week, Billable This Month, Realization Rate, Pending Approvals, and Compliance Alerts.', 'Click the Pending Approvals or Compliance Alerts cards to jump to those tabs.', 'Filter entries by date range, department, employee, client, status, or free-text search.', 'The summary table below shows all entries with employee, client/matter, task code, hours, narrative, and status.'] },
      { title: 'Clients & Matters', purpose: 'Configure the clients, matters, and activity codes that employees select when logging time in the HR app.', steps: ['Switch to the Clients & Matters tab.', 'Add or edit Clients — each client has a name and active/archived status.', 'Add Matters linked to a client — each matter has a name, rate card, daily cap, assigned employees, and allowed activity codes.', 'Restrict which activity codes are available per matter using the allowed-codes setting.', 'Only matters assigned to an employee appear in their HR app when logging time.'] },
      { title: 'Review & Approve Time Entries', purpose: 'Process submitted time entries grouped by week and employee.', steps: ['Switch to the Review & Approve tab.', 'Submissions are grouped by week and employee in the left panel, showing total hours, billable ratio, and flags.', 'Click a group to view its individual entries in the right panel.', 'Select one or more entries using the checkboxes, then Approve, Reject (with a mandatory reason), or Request Revision.', 'Click the edit icon on any entry to inline-edit the narrative, hours, or task code — an audit reason is recorded with every change.'] },
      { title: 'Compliance Monitoring', purpose: 'Monitor working time alerts, leave conflicts, and export data for billing systems.', steps: ['Switch to the Compliance tab.', 'Working Time Alerts flags employees exceeding the 10h/day or 48h/week statutory limits.', 'Leave Integration detects conflicts where time was logged on an approved leave day.', 'Export approved entries as CSV or LEDES 1998B format for integration with billing and practice management systems.', 'The Sync to Payroll button pushes approved hours into the payroll pipeline.'] },
      { title: 'Time Rounding Settings', purpose: 'Configure the company-wide auto-round up increment. This setting controls how the employee HR app rounds time entries when employees log legal time.', steps: ['Switch to the Settings tab.', 'Choose the rounding increment from the dropdown: 1 minute (no rounding), 5 minutes, 6 minutes (UK standard), 10 minutes, 15 minutes (quarter hour), or 30 minutes (half hour).', 'The change saves immediately and takes effect in the employee HR app on their next page load — the Log Time form label, rounding preview, and all new time entries automatically use the updated increment.', 'The "How it works" panel shows live examples of how durations are rounded at the selected increment.', 'This is a company-wide setting — all employees see and use the same increment.', 'Employees can still toggle auto-rounding off for individual entries if they need to log an exact duration.'], callout: { type: 'tip', text: 'The UK legal industry standard is 6 minutes (1/10th of an hour). The 5-minute increment is useful for firms that bill in smaller units. Changes are applied instantly — no employee action is required.' } },
    ],
  },
  {
    icon: '🔄', title: 'Shifts & Rotas',
    features: [
      { title: 'Shift Templates', purpose: 'Define reusable shift patterns that are used when building rotas. Employees see their assigned shifts in the HR app.', steps: ['Navigate to Admin > Shifts & Rotas from the sidebar.', 'The Shift Templates tab lists all defined templates.', 'Click + Add Template to create a new shift with: name, start/end times, break duration, colour, department, and role.', 'Toggle templates active or inactive. Only active templates appear when building rotas.'] },
      { title: 'Build & Publish Rotas', purpose: 'Create weekly rotas and assign employees to shifts. Published rotas appear in the employee HR app immediately.', steps: ['Switch to the Rotas & Scheduling tab.', 'Click + New Rota. Set a name and week start date.', 'Assign employees to shift templates for each day of the week.', 'The system checks for cross-system time overlaps (timesheets, legal timesheets) and warns you. Override conflicts if needed.', 'Click Publish to make the rota visible to employees — their Shifts page in the HR app updates immediately.'], callout: { type: 'note', text: 'Unpublished rotas are drafts visible only to admins. Employees only see shifts from published rotas.' } },
      { title: 'Reports & Analytics', purpose: 'Company-specific shift metrics for the current financial year.', steps: ['Switch to the Reports & Analytics tab.', 'View KPIs: total shifts, people worked, total hours, average hours per person, and break time.', 'Charts include: top 5 workers, most-used shifts, day-of-week distribution, monthly hours, hours by department, and shift coverage.', 'Set the financial year start month at the top of the page — this setting persists per company.'] },
    ],
  },
  {
    icon: '📚', title: 'E-Learning',
    features: [
      { title: 'Course Visibility', purpose: 'Control which e-learning courses from the platform catalogue are available to your employees in the HR app.', steps: ['Navigate to Admin > E-Learning from the sidebar.', 'The Visibility tab lists all available courses with a toggle switch for each.', 'Enable or disable individual courses — only enabled courses appear in the employee HR app.', 'Use Enable All / Disable All buttons for bulk changes.', 'Filter by category (Onboarding, Compliance, Policies, etc.) or industry to manage subsets quickly.', 'Use the search bar to find specific courses by title.'], callout: { type: 'tip', text: 'Disabling a course hides it from employees but does not delete their completion records. Re-enabling it restores visibility with progress intact.' } },
    ],
  },
  {
    icon: '🚀', title: 'Onboard / Offboard',
    features: [
      { title: 'Onboarding Dashboard', purpose: 'At-a-glance onboarding stats and pipeline for your company.', steps: ['Navigate to Admin > Onboard / Offboard from the sidebar.', 'The Dashboard tab shows: total starters, in-progress, due to join, overdue, and completed counts.', 'A monthly chart shows starters per month for the current financial year.', 'The pipeline view shows how many starters are at each workflow stage.'] },
      { title: 'Create a New Starter', purpose: 'Add a new employee through the structured onboarding workflow. The employee record is created and activated at the final step.', steps: ['Switch to the New Starter tab.', 'Fill in basic details: name, email, job title, department, start date, and contract type.', 'Optionally complete personal information, address, employment history, emergency contact, and bank details.', 'Click Create & Start Workflow to begin the 8-step onboarding process.'] },
      { title: 'Bulk Upload', purpose: 'Create multiple starters at once from a spreadsheet.', steps: ['Switch to the Bulk Upload tab.', 'Download the Excel template, fill it in with multiple starter records, and upload.', 'Review the preview table and fix any validation errors, then confirm the upload.'] },
      { title: 'Onboard Workflow', purpose: 'Track each new starter through 8 sequential onboarding steps.', steps: ['Switch to the Onboard Workflow tab (or click Workflow on any starter record).', 'Steps: Create Details → Order Equipment → Organise First Meeting → Notify Manager → Plan First Day → Inform Starter → Create Accounts & Licences → Day 1 Access Verification.', 'Mark each step complete or skip if not applicable.', 'The final step (Day 1 Access) creates the employee record and activates their HR app account — they can then sign in.'] },
      { title: 'Start Offboarding', purpose: 'Begin the offboarding process for a departing employee.', steps: ['Switch to the Offboarding tab.', 'Search for the employee by name using the search bar.', 'Select the employee from the results, set their end date and reason for leaving.', 'Click Start Offboarding to create the record and begin the workflow.'], callout: { type: 'note', text: 'Only active, onboarded employees appear in the search. Employees already being offboarded are excluded.' } },
      { title: 'Offboarding Workflow', purpose: 'Guide a leaver through 5 sequential offboarding steps.', steps: ['Switch to the Offboarding Workflow tab (or click Workflow on an active offboarding record).', 'Steps: Approve Resignation (HR) → Recover Equipment → Organise Leaving Meeting (Manager) → Remove Employee Accounts/Licences → Agree/Confirm Last Payments.', 'Mark each step complete or skip if not applicable. You can undo a completed step if needed.', 'After marking the final step complete, a confirmation modal appears asking you to approve or decline freezing the employee\'s HR app account.'] },
      { title: 'Freeze & Deletion Queue', purpose: 'Frozen employees are blocked from signing in to the HR app and placed in a 30-day deletion queue.', steps: ['When you approve the freeze, the employee is immediately deactivated — they can no longer sign in to the HR app.', 'The frozen employee appears in the Deletion Queue table on the Offboarding tab with their freeze date and scheduled deletion date (30 days later).', 'Each record shows a status: Awaiting Expiry, Ready to Delete, or Recovered.', 'Click Recover to reinstate the employee — their HR app account is reactivated and they can sign in again.', 'Click Delete to permanently remove the employee record before the 30-day period.'], callout: { type: 'tip', text: 'Recovery is available at any time before deletion. The employee\'s data is fully preserved during the 30-day freeze period.' } },
      { title: 'Cancel Offboarding', purpose: 'Remove an in-progress offboarding record before it is completed.', steps: ['On the Offboarding tab, find the employee under Active Offboarding.', 'Click the Cancel button on their record.', 'Confirm the cancellation — the offboarding record is removed and the employee remains active with full HR app access.'] },
    ],
  },
  {
    icon: '⭐', title: 'Kudos',
    features: [
      { title: 'Moderate Kudos', purpose: 'Oversee all recognition posts across the company. Kudos are created by employees in the HR app — this page lets you review and moderate them.', steps: ['Navigate to Admin > Kudos from the sidebar.', 'View all kudos posts with sender, recipient, category, badge, and message.', 'Search by employee name to find specific posts.', 'Delete inappropriate or incorrect kudos if necessary.'], callout: { type: 'note', text: 'Kudos are created by employees in the HR app under Home > Kudos. This admin page is for moderation only — you cannot create kudos from here.' } },
    ],
  },
  {
    icon: '📢', title: 'Announcements',
    features: [
      { title: 'Create & Manage Announcements', purpose: 'Publish company-wide announcements that appear on every employee\'s dashboard and in the Company tab of their Notifications page in the HR app.', steps: ['Navigate to Admin > Announcements from the sidebar.', 'Click + New Announcement.', 'Write a title and body, then publish.', 'The announcement appears as a banner on the employee dashboard and in the Company notifications tab.', 'Pin important announcements to keep them at the top of the feed.', 'Edit or delete existing announcements as needed.'] },
    ],
  },
  {
    icon: '🎫', title: 'HR Tickets',
    features: [
      { title: 'Manage Employee Tickets', purpose: 'Respond to and resolve HR queries raised by employees. Employees submit tickets from the HR app and see status updates there.', steps: ['Navigate to Admin > HR Tickets from the sidebar.', 'Stat badges at the top show counts for: Open, In Progress, Resolved, and Urgent tickets.', 'Filter tickets by status or priority to focus on items needing action.', 'Click any ticket to view details, update the status, change priority, reassign, or add a response.', 'Status changes are visible to the employee in their HR app.'] },
      { title: 'Create a Ticket', purpose: 'Raise an internal HR ticket on behalf of an employee or for an internal task.', steps: ['Click + New Ticket.', 'Enter a title, description, category, priority level, and assign to an admin or HR team member.', 'The ticket appears in the ticket list and can be tracked through to resolution.'] },
    ],
  },
  {
    icon: '🎁', title: 'Benefits',
    features: [
      { title: 'Configure Benefit Types', purpose: 'Set up the benefit plans that employees can browse and enrol in through the HR app.', steps: ['Navigate to Admin > Benefits from the sidebar.', 'The Benefit Types tab lists all configured benefit plans.', 'Click + Add Benefit Type to create a new plan with: title, description, cost, eligibility criteria, and lock period (monthly or yearly).', 'Enable or disable benefit types — only enabled types appear in the employee HR app.', 'Expand any benefit type to see which employees are currently enrolled.'] },
      { title: 'View Subscriptions', purpose: 'Track employee enrolments across all benefit plans.', steps: ['Switch to the Subscriptions tab.', 'View all active benefit subscriptions with employee name, plan, enrolment date, and status.'] },
      { title: 'Manage Benefit Documents', purpose: 'Upload and manage documents associated with benefit plans (policy documents, T&Cs, etc.).', steps: ['Switch to the Documents tab.', 'Upload, view, or remove documents linked to benefit plans.'] },
    ],
  },
  {
    icon: '🎯', title: 'Performance',
    features: [
      { title: 'Manager Hierarchy', purpose: 'View and configure the manager-to-report structure that drives 1-to-1 meetings in the HR app.', steps: ['Navigate to Admin > Performance from the sidebar.', 'The page shows the manager hierarchy — which employees report to which managers.', 'Click Reassign on any employee to change their reporting manager using the reassign modal.', 'Employees without an assigned manager are listed in the Unassigned section — click Assign to set their manager.'] },
      { title: 'E-Learning Progress', purpose: 'View per-employee e-learning completion stats.', steps: ['Click the E-Learning icon on any employee row to open a modal showing their course completion progress, total time invested, and outstanding courses.'] },
    ],
  },
  {
    icon: '🏢', title: 'Space Management',
    features: [
      { title: 'Locations & Floors', purpose: 'Define your office locations and floor plans. Employees use these when booking desks and rooms in the HR app.', steps: ['Navigate to Admin > Space Management from the sidebar.', 'Click + Add Location to create a new office (e.g. "London HQ", "Manchester Office").', 'Within each location, click + Add Floor to add floors (e.g. "Ground Floor", "Floor 2").', 'Changes are reflected immediately in the employee HR app under Space Booking.'] },
      { title: 'Spaces (Desks & Rooms)', purpose: 'Add bookable desks and meeting rooms to each floor.', steps: ['Within a floor, click + Add Space.', 'Set the space name, type (desk or room), capacity, and status (available, maintenance, etc.).', 'Employees see available spaces when booking in the HR app.'] },
      { title: 'Equipment Management', purpose: 'Tag meeting rooms with available equipment so employees can filter by equipment in the HR app.', steps: ['Select a room and add equipment tags: projector, whiteboard, video conferencing, large display, etc.', 'In the employee HR app, the equipment filter on the Space Booking page lets employees find rooms with specific kit.'] },
      { title: 'Occupancy Analytics', purpose: 'Understand how your spaces are being used to inform office planning.', steps: ['Switch to the Analytics tab.', 'View occupancy rates, peak booking days, and utilisation broken down by location.', 'Use this data to optimise desk/room allocation and identify underused spaces.'] },
    ],
  },
  {
    icon: '💻', title: 'Asset Management',
    features: [
      { title: 'Asset Register', purpose: 'View, search, and filter all company assets in a central register.', steps: ['Navigate to Admin > Asset Management from the sidebar.', 'The summary bar shows total assets and counts by status (Assigned, Unassigned, Maintenance, Retired, Sold, Broken).', 'Use the search bar to find assets by name, brand, model, or assigned owner.', 'Filter by asset type, status, or registered owner using the dropdown filters.'] },
      { title: 'Add an Asset', purpose: 'Register a new company asset with full details.', steps: ['Click + Add Asset.', 'Enter asset type, brand, model, serial number, purchase date, warranty expiry, and optional notes.', 'The Asset Name is auto-generated (e.g. LAPTOP-0001) if left blank, or enter a custom name.', 'Optionally assign the asset to an employee and set the initial status.', 'If Space Management is enabled, tick "Room / Desk Asset" to make this asset available for linking to rooms or desks.', 'Click Save Asset.'] },
      { title: 'View & Edit Asset Details', purpose: 'Expand any asset row to see full details or edit all fields.', steps: ['Click the expand arrow on any asset row to see all details: name, type, brand, model, serial number, dates, status, owner, and notes.', 'Click the Edit button (pencil icon) to open inline editing for all fields.', 'Save changes or Cancel.'] },
      { title: 'Change Asset Status', purpose: 'Move an asset between statuses: Assigned, Unassigned, Maintenance, Retired, Sold, or Broken.', steps: ['Expand the asset row to see the detail panel.', 'Click the status change buttons (e.g. "→ Maintenance", "→ Retired") to update the status instantly.', 'All status changes are recorded in the asset history.'], callout: { type: 'note', text: 'Changing status to anything other than Assigned will automatically unassign the current owner.' } },
      { title: 'Swap Ownership', purpose: 'Transfer an asset from one employee to another.', steps: ['Click the swap icon (🔄) on the asset row.', 'In the popup, the current owner is displayed. Select the new owner from the employee dropdown.', 'Click Confirm Swap. Both the old and new assignments are recorded in history.'] },
      { title: 'Asset History', purpose: 'View a full audit trail of ownership changes and status updates for any asset.', steps: ['Click the history icon (📋) on any asset row.', 'The history modal shows all actions: assignments, swaps, status changes — with from/to employee names and timestamps.'] },
      { title: 'Import Assets via CSV', purpose: 'Bulk-import assets from a CSV file.', steps: ['Click Download Template to get the CSV template with the required column headers.', 'Fill in the template with your asset data. Use employee email addresses in the assigned_to_email column to auto-match employees.', 'Click Import CSV and select your completed file. Assets are created with auto-generated names.'], callout: { type: 'tip', text: 'Download the template first to see the expected columns and an example row.' } },
      { title: 'Export to CSV', purpose: 'Export the current asset list (respecting active filters) to a CSV file.', steps: ['Click Export CSV.', 'The downloaded file includes all asset fields: name, type, brand, model, serial number, dates, status, owner, space asset flag, and notes.'] },
      { title: 'Delete an Asset', purpose: 'Permanently remove an asset and all its history records.', steps: ['Click the delete icon (🗑️) on the asset row.', 'Confirm the deletion in the dialog. This removes the asset and its full history permanently.'], callout: { type: 'note', text: 'Deletion cannot be undone. Export the asset data first if you need a record.' } },
      { title: 'Room / Desk Assets', purpose: 'When Space Management is also enabled, mark assets as room or desk assets so they can be linked to spaces.', steps: ['When adding or editing an asset, tick the "Room / Desk Asset" checkbox.', 'These assets then appear in the Space Management > Spaces form under "Linked Assets".', 'Admins can assign multiple assets to any desk or meeting room.'], callout: { type: 'tip', text: 'This feature only appears when both Asset Management and Space Management are enabled for your company.' } },
    ],
  },
  {
    icon: '🔔', title: 'Notifications',
    features: [
      { title: 'Workflow Notifications', purpose: 'Configure automated notification rules for HR workflows (approvals, status changes, reminders).', steps: ['Navigate to Admin > Notifications from the sidebar.', 'The Workflow tab lists notification rules for system events.', 'Review and customise which events trigger notifications and their content.'] },
      { title: 'Company Notification Settings', purpose: 'Configure company-level notification preferences.', steps: ['Switch to the Company tab.', 'Manage company-wide notification settings that control what employees receive in their HR app Notifications page.'] },
    ],
  },
  {
    icon: '💳', title: 'Billing',
    features: [
      { title: 'View Subscription & Costs', purpose: 'See a breakdown of your company\'s InflowHR subscription and download invoices.', steps: ['Navigate to Admin > Billing from the sidebar.', 'The core plan card shows your subscription tier.', 'The pricing table lists each enabled feature module with its per-user monthly cost.', 'View your total employee count and calculated monthly total (net + 20% VAT).', 'Monthly invoice history is listed below — click any invoice to download the PDF.'], callout: { type: 'note', text: 'Feature activation and pricing changes are managed by the InflowHR platform team. Contact your account manager to adjust your subscription.' } },
    ],
  },
  {
    icon: '📖', title: 'User Guides',
    features: [
      { title: 'Reference Documentation', purpose: 'This page — comprehensive guides for all InflowHR features organised by role.', steps: ['Navigate to Admin > User Guides from the sidebar.', 'Switch between tabs: Employee (how the HR app works for employees), Company Admin (this guide — admin configuration and management), and Super Admin (platform-level controls, visible to super admins only).', 'Click any section heading to expand or collapse the guide content.'] },
    ],
  },
]

const SUPER_SECTIONS: GuideSection[] = [
  {
    icon: '🏢', title: 'Company Management',
    features: [
      { title: 'Create a Company', purpose: 'Register a new tenant on the platform.', steps: ['Navigate to Admin > Subscriptions > Companies.', 'Tap + Register New Company.', 'Enter the company name, email domain (e.g. acme.co.uk), and optionally upload a company logo.', 'Tap Register Company. The company is created with default leave types, feature settings, and a welcome announcement.'] },
      { title: 'Edit & Deactivate Companies', purpose: 'Update company details or disable access.', steps: ['From the Companies tab, use the logo, status, and login controls on each company row.', 'Click the logo cell to upload or change a company logo. Click the X to remove it.', 'Toggle Active off to deactivate the entire company. All employees lose access immediately.', 'Toggle Login Disabled to temporarily block sign-in without deactivating.'], callout: { type: 'note', text: 'Deactivating a company does not delete any data. Reactivation restores full access.' } },
      { title: 'Manage Company Admins', purpose: 'Add or remove multiple admin users for each company. Admin employees see the "Go to Admin Portal" button in their HR app Settings page.', steps: ['In the Company Admins column, existing admins are listed by name.', 'Click + Add Admin to open the employee selector. Only active, onboarded employees are shown.', 'Select an employee to grant them admin access. Their company_users role is set to admin and they can access the Admin Portal immediately.', 'Click the X button next to any admin\'s name to remove their admin access.', 'Multiple admins can be assigned per company — there is no limit.'], callout: { type: 'tip', text: 'Removing an admin does not deactivate their employee account — it only revokes their access to the Admin Portal.' } },
      { title: 'Export, Import & Archive', purpose: 'Manage company data lifecycle.', steps: ['Export — downloads a CSV of all company data for the current financial year.', 'Import — upload a previously exported CSV to restore data into a company.', 'Archive — saves company FY data to the documents folder, with an optional delete of the source data after archiving.'] },
      { title: 'Delete a Company', purpose: 'Permanently remove a company and all its data.', steps: ['Click the delete icon on the company row.', 'Confirm the deletion in the dialog. This action cannot be undone.'], callout: { type: 'note', text: 'You cannot delete your own company. All associated data (employees, leave, expenses, etc.) is permanently removed.' } },
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
  const [empOpen, setEmpOpen] = useState<Record<number, boolean>>({})
  const [admOpen, setAdmOpen] = useState<Record<number, boolean>>({})
  const [supOpen, setSupOpen] = useState<Record<number, boolean>>({})

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
