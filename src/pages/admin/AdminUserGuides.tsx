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
      { title: 'Request Leave', purpose: 'Submit a new leave request for manager approval.', steps: ['Tap + Request Leave on the Time Off page.', 'Select the leave type, start and end dates, and add an optional note.', 'Tap Submit. Your manager receives a notification to approve or decline. If your company has Teams Integration enabled, your manager also receives a Microsoft Teams message.'], callout: { type: 'note', text: 'Requests that exceed your remaining allowance will be flagged. Check your balance before submitting.' } },
      { title: 'Leave Calendar', purpose: 'See who in your team is off and when.', steps: ['From the Time Off page, tap Calendar.', 'Approved leave for your department is displayed on a shared calendar view.'] },
      { title: 'Leave History', purpose: 'Review all past and pending requests.', steps: ['From the Time Off page, tap History.', 'Filter by status (pending, approved, rejected) to find specific requests.'] },
      { title: '"I\'m Off" Quick Notification', purpose: 'Instantly notify your team you are away today.', steps: ['Tap the I\'m Off button on the Time Off page.', 'A notification is sent to your manager and team immediately.'] },
    ],
  },
  {
    icon: '💰', title: 'Expenses',
    features: [
      { title: 'Submit an Expense Claim', purpose: 'Claim back money you have spent on company business.', steps: ['Navigate to Home > Expenses and tap + New Claim.', 'Give the claim a title and tap to add line items.', 'For each item: enter a title, expense type, description, date, and cost. Snap a receipt photo or upload a PDF.', 'For mileage claims: enter the from and to postcodes or addresses, total miles, and tick "Include return journey" if applicable.', 'When all items are added, tap Submit to send for approval. If your company has Teams Integration enabled, your manager also receives a Microsoft Teams message.'], callout: { type: 'tip', text: 'Save claims as Draft if you need to add receipts later. Drafts are only visible to you.' } },
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
      { title: 'Shift Swaps', purpose: 'Request to swap a shift with a colleague through a two-step negotiation.', steps: ['Tap Swap on the Shifts page.', 'Select the shift you want to swap and the colleague you want to swap with. Add an optional message explaining why.', 'Your colleague receives a notification and can respond with a counter-offer — selecting one of their own shifts to swap with yours.', 'You then review the counter-offer and approve or decline it. Both parties are notified of every status change.', 'The Swap History tab shows each swap as a condensed timeline card — tap to expand and see the full conversation, including all messages and status changes.'], callout: { type: 'note', text: 'Your colleague cannot offer a shift on a date you are already assigned to work, preventing scheduling conflicts.' } },
      { title: 'Set Your Availability', purpose: 'Tell your manager which days and times you are available to work.', steps: ['Tap Availability on the Shifts page.', 'Toggle each day on or off and set preferred start/end times.', 'Tap Save. Managers see this when building rotas.'] },
      { title: 'Work Patterns', purpose: 'Your contracted working days determine your dashboard status and shift eligibility.', steps: ['Your admin assigns a work pattern to your profile (e.g. Monday to Friday, or a variable pattern).', 'On non-contracted days, your Dashboard shows "Off Work" instead of "At Work".', 'Admins cannot assign you to a shift on a day outside your work pattern.'] },
      { title: 'Shift Skills', purpose: 'Skills assigned to your profile determine which shifts you are eligible for.', steps: ['Your admin assigns shift skills to your employee record (e.g. First Aid, Forklift, Cash Handling).', 'When a shift template requires specific skills, only employees with at least one matching skill can be assigned.', 'Shifts with no skill requirements can be assigned to any employee.'] },
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
      { title: 'Performance Goals', purpose: 'Set, track, and manage goals for yourself and your direct reports across the financial year.', steps: ['Navigate to Home > Performance Goals.', 'View your own goals on the My Goals tab — each goal shows title, status, due date, and optional grade.', 'Tap + New Goal to create a goal with a title, description, start and due dates.', 'Update goal status: Active, Completed, Edited, On Hold, or Cancelled.', 'Add comments to goals for ongoing discussions with your manager.'], callout: { type: 'note', text: 'Managers can also view and manage goals for their direct reports using the team selector at the top of the page.' } },
    ],
  },
  {
    icon: '🎁', title: 'Benefits',
    features: [
      { title: 'Browse & Enrol in Benefits', purpose: 'View available benefit plans and opt in or out.', steps: ['Navigate to Home > Benefits.', 'Each benefit shows a description, eligibility, cost, and lock period.', 'Tap Enrol to opt in. Some benefits have a lock period (monthly or yearly) during which you cannot unenrol.'] },
    ],
  },
  {
    icon: '🧠', title: 'Skills Passport',
    features: [
      { title: 'Add & Rate Your Skills', purpose: 'Build your professional skills profile by declaring skills and self-rating your proficiency.', steps: ['Navigate to Home > Skills Passport.', 'The Skills tab shows your current skill set organised by category.', 'Tap + Add Skill, select a category and skill, then rate your proficiency from 1 (Foundational) to 5 (Expert).', 'Skills start as Self-declared. You can request validation from a colleague or manager.'] },
      { title: 'Certifications', purpose: 'Record professional certifications and track expiry dates.', steps: ['Switch to the Certifications tab.', 'Tap + Add Certification and enter the name, issuing body, issue date, optional expiry date, and credential ID or URL.', 'Certifications are listed with their current status — active, expired, or pending renewal.'] },
      { title: 'Career Aspirations', purpose: 'Set your career goals so managers can align development opportunities.', steps: ['Switch to the Aspirations tab.', 'Set your target role, target department, and timeframe (6 months to 3+ years).', 'Add optional notes about your career plans.'] },
      { title: 'Role Matching', purpose: 'See how your current skills align with defined role profiles in your company.', steps: ['Switch to the Matching tab.', 'Each role profile shows a match percentage based on your skills vs. the role\'s requirements.', 'Gap analysis highlights which skills you need to develop to qualify for each role.'], callout: { type: 'tip', text: 'Building out your skills profile helps your manager and HR team understand your capabilities and career aspirations.' } },
    ],
  },
  {
    icon: '🏢', title: 'Space Booking',
    features: [
      { title: 'Book a Desk or Meeting Room', purpose: 'Reserve workspace or meeting rooms at your office locations.', steps: ['Navigate to Home > Space Booking.', 'Select a location and floor. Available desks and rooms are listed with capacity and equipment tags.', 'Pick a date, select your space, choose a time slot, and tap Book.'], callout: { type: 'tip', text: 'Use the equipment filter to find rooms with specific kit (projector, whiteboard, video conferencing, etc.).' } },
      { title: 'Manage Your Bookings', purpose: 'View, edit, or cancel existing bookings.', steps: ['Your upcoming bookings appear on the Space Booking page. Tap a booking to view details or cancel.'] },
      { title: 'Schedule-Aware Booking', purpose: 'See your shift schedule alongside space bookings to help you book on the right days.', steps: ['If your company uses Shifts & Rotas, a schedule banner appears at the top of the Space Booking page.', 'Clickable chips show each day you are assigned a shift, with the shift name, times, and number of colleagues working.', 'Tap a chip to auto-set the booking date to that day.'], callout: { type: 'tip', text: 'This helps you book a desk or room on days you are scheduled to be in the office.' } },
    ],
  },
  {
    icon: '🎫', title: 'HR Tickets',
    features: [
      { title: 'Raise an HR Ticket', purpose: 'Submit a query or request to your HR team.', steps: ['Navigate to Home > HR Tickets.', 'Tap + New Ticket and enter a subject, description, and priority level.', 'Submit the ticket. Your HR team receives a notification and can respond.'] },
      { title: 'Track Your Tickets', purpose: 'Follow the progress of tickets you have raised.', steps: ['Your HR Tickets page lists all your submitted tickets with status badges: Open, In Progress, or Resolved.', 'Tap any ticket to view the full conversation thread and status updates.'] },
    ],
  },
  {
    icon: '📋', title: 'Check-In',
    features: [
      { title: 'Timesheet Check-In', purpose: 'Clock in and out of your working day with a live timer, breaks, and location tracking.', steps: ['Navigate to Home > Timesheet Check-In (or tap the Check-In prompt on your Dashboard).', 'Select your work location (on-site or work from home) and tap Check In.', 'A live timer shows your elapsed working time. Use Start Break to log breaks (lunch, short break, etc.).', 'Tap Check Out when you finish. Your check-in record appears in the history below.'], callout: { type: 'note', text: 'Check-in is only available if your company admin has enabled it. If geolocation is required, your browser will ask for location permission.' } },
      { title: 'Shift Check-In', purpose: 'Check in and out of your assigned shifts.', steps: ['Navigate to Home > Shift Check-In (or tap Check In from the My Shifts page).', 'Your assigned shift for today is displayed at the top with times and shift name.', 'Tap Check In to start, use breaks as needed, and tap Check Out when your shift ends.', 'Your check-in history for the current month is shown below.'] },
    ],
  },
  {
    icon: '📊', title: 'Dashboard',
    features: [
      { title: 'Home Dashboard', purpose: 'Your personalised landing page showing quick-access cards for all enabled features.', steps: ['The Dashboard is the first page you see after signing in.', 'Feature cards provide one-tap access to Leave, Expenses, Payslips, Timesheets, Shifts, E-Learning, Kudos, Performance, Benefits, Space Booking, Skills Passport, and more.', 'Stat summaries on each card show key numbers at a glance (e.g. leave remaining, pending expenses).', 'A birthday card shows upcoming birthdays for colleagues on your watchlist within the next 30 days.', 'If your company has enabled geolocation consent and you have granted it, a live weather widget appears on your dashboard showing current conditions for your location.'] },
      { title: 'Detailed Dashboard', purpose: 'An expanded view with richer data across all your HR features.', steps: ['Tap the Detailed Dashboard link on the home page.', 'View breakdowns for leave usage, expense trends, timesheet hours, shift patterns, and more.', 'The birthday section shows watchlisted colleagues with birthdays in the next 30 days.'], callout: { type: 'tip', text: 'Add colleagues to your watchlist from the Directory page to see their upcoming birthdays on your dashboard.' } },
    ],
  },
  {
    icon: '👤', title: 'Profile & Directory',
    features: [
      { title: 'My Profile', purpose: 'View and update your personal details.', steps: ['Navigate to Home > My Profile.', 'View your job title, department, contract type, contact details, and emergency contacts.', 'Upload or change your avatar photo.'] },
      { title: 'Company Directory', purpose: 'Find colleagues by name, department, or job title.', steps: ['Tap Directory in the bottom navigation.', 'Search or scroll to find a colleague. Tap to view their profile card with contact details.', 'If your company has Teams Integration (Pack B) enabled, a coloured presence dot appears next to each colleague showing their Microsoft Teams status: green (Available), yellow (Away/Be Right Back), red (Busy/Do Not Disturb), or grey (Offline/Unknown).', 'Tap the phone icon on a profile card to call the colleague directly.'] },
      { title: 'My Assets', purpose: 'View the company assets assigned to you.', steps: ['Navigate to My Profile and switch to the Job tab.', 'If your company has Asset Management enabled, a My Assets button appears next to the Department Members button.', 'Tap My Assets to open a popup listing all assets assigned to you — showing asset name and type.'], callout: { type: 'note', text: 'This button only appears if your company admin has enabled the Asset Management feature.' } },
      { title: 'Watchlist', purpose: 'Follow colleagues to see their upcoming birthdays on your dashboard.', steps: ['Open the Directory and tap a colleague\'s profile card.', 'Tap the star/watchlist icon to add them to your personal watchlist.', 'Watchlisted colleagues with birthdays in the next 30 days appear on your Dashboard birthday card.', 'Tap the star again to remove someone from your watchlist.'] },
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
      { title: 'Privacy & Consent', purpose: 'Manage your data consent preferences for features that use personal information.', steps: ['Navigate to Settings from the bottom bar.', 'The Privacy section shows consent toggles for geolocation (used by the weather widget and check-in location tracking).', 'Grant or withdraw consent at any time — the change takes effect immediately.', 'Withdrawing geolocation consent hides the weather widget from your dashboard and disables location tracking for check-in.'], callout: { type: 'note', text: 'Your consent preferences are stored securely with a timestamp and are GDPR-compliant. You can withdraw consent at any time without affecting your other HR features.' } },
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
      { title: 'Work Patterns', purpose: 'Manage contracted working day patterns and assign them to employees.', steps: ['Switch to the Work Patterns tab on the Employees page.', 'Default patterns are provided (Mon–Fri, Mon–Sat, Variable). Create custom patterns by toggling days.', 'Assign a pattern to each employee from their profile or the management tab.', 'Employees on non-contracted days see "Off Work" on their dashboard and cannot be assigned shifts on those days.'] },
      { title: 'Shift Skills on Employee Records', purpose: 'Assign shift skills to individual employees to control their shift eligibility.', steps: ['Click an employee row to expand their record.', 'Open the Shift Skills module in the employee record.', 'Tick the skills this employee holds (e.g. First Aid, Forklift, Cash Handling).', 'Click Save to update. The employee is now eligible for shifts requiring those skills.'] },
    ],
  },
  {
    icon: '🏖️', title: 'Leave',
    features: [
      { title: 'Approve or Decline Leave Requests', purpose: 'Process all pending leave requests submitted by employees in the HR app.', steps: ['Navigate to Admin > Leave from the sidebar.', 'All pending requests are listed with the employee name, leave type, dates, and current status.', 'Click Approve or Decline on each request. The employee is notified immediately in their HR app.'], callout: { type: 'note', text: 'If your company has an active Teams Integration subscription and the bot is configured, managers also receive a Microsoft Teams message when an employee submits a leave request.' } },
      { title: 'Configure Leave Types', purpose: 'Control which leave types are available to employees and whether they deduct from allowance.', steps: ['Scroll to the Leave Type Settings section on the same page.', 'Toggle "Deducts from Allowance" on or off for each type (e.g. Sick Leave typically does not deduct, Annual Leave does).', 'These settings apply company-wide — employees see the updated leave types immediately when requesting leave in the HR app.'], callout: { type: 'tip', text: 'Per-employee allowance overrides (e.g. giving one person extra annual leave) can be set from their individual profile in Admin > Employees.' } },
      { title: 'Configure Weekend Settings', purpose: 'Define which days are treated as weekends for leave calculations.', steps: ['Use the Weekend Settings section to configure which days count as non-working days.', 'This affects how leave duration is calculated when employees submit requests in the HR app.'] },
      { title: 'Leave Analytics', purpose: 'View leave trends across the company.', steps: ['A stacked bar chart at the bottom shows approved leave by month broken down by leave type for the current financial year.'] },
    ],
  },
  {
    icon: '💰', title: 'Expenses',
    features: [
      { title: 'Process Expense Claims', purpose: 'Review, approve, or reject expense claims submitted by employees through the HR app.', steps: ['Navigate to Admin > Expenses from the sidebar.', 'The Claims tab lists all submitted claims with employee name, amount, type, and status.', 'Filter by status (Pending, Approved, Rejected) to focus on items needing action.', 'Click any claim to view full details, attached receipt images/PDFs, and the audit trail.', 'Click Approve or Reject with an optional comment. The employee sees the updated status in their HR app.'], callout: { type: 'note', text: 'If your company has an active Teams Integration subscription and the bot is configured, managers also receive a Microsoft Teams message when an employee submits an expense claim.' } },
      { title: 'Export Expenses', purpose: 'Download all pending and approved expense claims from the last 30 days as a zip file with CSV summary and receipt attachments.', steps: ['Click the Export Expenses button (available on both the Claims tab and the Exports tab).', 'A zip file is generated containing a CSV of all claim line items and a receipts folder with all uploaded receipt files.', 'The zip downloads automatically with a date-stamped filename (e.g. Expenses_12-08-2026.zip).'], callout: { type: 'tip', text: 'The export covers the last 30 days of pending and approved claims for your company only. Run exports regularly to stay on top of expense processing.' } },
      { title: 'Export for Xero or Sage', purpose: 'Generate accounting-software-ready CSV files for approved expenses by financial year month.', steps: ['On the Claims tab or Exports tab, select the FY month from the dropdown.', 'Click Export for Xero to download a Xero Bill import CSV with account codes mapped to expense types.', 'Click Export for Sage to download a Sage 50 Purchase Invoice CSV with nominal codes (e.g. 7104 for travel, 7103 for mileage, 7105 for hotels) and T1 tax code at 20% VAT.', 'Each line item becomes a row in the CSV, ready to import directly into your accounting software.'], callout: { type: 'tip', text: 'Xero and Sage exports only include approved claims for the selected month. Use the standard Export Expenses for a full zip with receipts.' } },
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
      { title: 'Shift Skills', purpose: 'Create company-specific skills that can be required on shift templates and assigned to employees. Only eligible employees can be assigned to skill-restricted shifts.', steps: ['Switch to the Shift Skills tab.', 'Click + Add Skill to create a new skill (e.g. First Aid, Forklift, Cash Handling).', 'Edit a skill name inline, or toggle it active/inactive. Inactive skills remain assigned but cannot be added to new templates.', 'Delete a skill only if it is not assigned to any templates or employees — otherwise disable it.', 'Assign required skills to shift templates on the Shift Templates tab using the Required Skills checkboxes.', 'Assign skills to employees via Admin > Employees > employee record > Shift Skills module.'], callout: { type: 'note', text: 'If a shift template has required skills, an employee must have at least one matching skill to be assigned. Shifts with no skills can be assigned to anyone.' } },
      { title: 'Work Patterns', purpose: 'Define contracted working day patterns and assign them to employees. Work patterns control which days employees can be assigned shifts and affect their dashboard status.', steps: ['Navigate to Admin > Employees and switch to the Work Patterns tab.', 'Default patterns are provided: Monday–Friday, Monday–Saturday, and Variable (any day).', 'Create custom patterns by toggling specific days of the week on or off.', 'Assign a pattern to each employee — their profile shows the assigned pattern.', 'When building rotas, the system blocks shift assignment on non-contracted days.', 'On non-contracted days, the employee\'s dashboard shows "Off Work" instead of "At Work".'], callout: { type: 'tip', text: 'Use the Variable pattern for employees who work flexible or rotating schedules — it allows assignment on any day.' } },
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
    icon: '🧠', title: 'Talent Intelligence',
    features: [
      { title: 'Skills Library', purpose: 'Manage the company-wide catalogue of skill categories and individual skills that employees can add to their Skills Passport.', steps: ['Navigate to Admin > Talent Intelligence from the sidebar.', 'The Library tab shows all skill categories (system defaults and company-created).', 'Click + Add Category to create a custom skill category, then add individual skills within it.', 'Toggle skills active or inactive — inactive skills cannot be selected by employees.'] },
      { title: 'Validation Requests', purpose: 'Review and action skill validation requests submitted by employees.', steps: ['Switch to the Requests tab.', 'Pending validation requests are listed with the employee name, skill, proficiency level, and date.', 'Click Validate to confirm the employee\'s proficiency, or Reject with an optional note.'] },
      { title: 'Role Profiles', purpose: 'Define role profiles with required skills and proficiency levels so employees can see how they match.', steps: ['Switch to the Roles tab.', 'Click + Add Role Profile and enter a title, department, and description.', 'Add skill requirements to each role — select the skill, minimum proficiency, and whether it is essential.', 'Employees see their match percentage against these profiles in their Skills Passport > Matching tab.'] },
      { title: 'Analytics', purpose: 'View company-wide skill coverage and gap analysis.', steps: ['Switch to the Analytics tab.', 'View charts showing top skills, average proficiency, skills gaps, and department coverage.'], callout: { type: 'tip', text: 'Use analytics to identify training needs and plan development programmes based on actual skill data.' } },
    ],
  },
  {
    icon: '📋', title: 'Check-In',
    features: [
      { title: 'Check-In Settings', purpose: 'Configure check-in rules for timesheets and shifts.', steps: ['Navigate to Admin > Timesheets or Admin > Shifts & Rotas and switch to the Check-In tab.', 'Enable or disable check-in for timesheets and/or shifts independently.', 'Configure settings: require geolocation, set work locations, define auto-checkout time, and set break policies.', 'Add work locations by name — employees select these when checking in on-site.'] },
      { title: 'Check-In Dashboard', purpose: 'Monitor live check-in activity across your company.', steps: ['The Check-In tab on Admin > Timesheets and Admin > Shifts & Rotas shows live check-in data.', 'View who is currently checked in, their location, elapsed time, and break status.', 'Historical records show all check-in/check-out entries with times, locations, and durations.', 'Export check-in data as CSV for payroll or compliance reporting.'] },
      { title: 'Rota Check-In Status', purpose: 'See check-in status overlaid on shift rotas.', steps: ['On the Rotas & Scheduling tab, employee cards in the rota grid show a check-in status badge.', 'Expand a rota employee row to see their individual check-in history for that week.'] },
      { title: 'Check-In Analytics', purpose: 'View aggregated check-in metrics in the Shifts & Rotas Reports & Analytics tab.', steps: ['Check-in metrics are included in the Reports & Analytics tab: on-time rate, late arrivals, average hours, and location breakdowns.', 'These metrics are only visible when check-in is enabled.'] },
    ],
  },
  {
    icon: '🔐', title: 'Access Management',
    features: [
      { title: 'Role-Based Access', purpose: 'Assign granular access roles to employees beyond the standard Admin/Employee/HR roles.', steps: ['Navigate to Admin > Access Management from the sidebar.', 'Available roles: Read Only View, Accounting, Management, Support, and Company Admin.', 'Assign roles to employees — each role grants access to specific admin features and data.', 'Click + Add to assign a role, or X to remove one. Changes take effect immediately.'] },
      { title: 'Role Permissions', purpose: 'View and configure what each role can access.', steps: ['The permissions grid shows which features each role can access (view, edit, approve, export, etc.).', 'Permissions are predefined per role but can be reviewed for audit purposes.'], callout: { type: 'note', text: 'Access Management provides more granular control than the basic Admin/Employee role. Use it when different admins need access to different parts of the system.' } },
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
    icon: '🔗', title: 'Integrations',
    features: [
      { title: 'Xero Integration (Core)', purpose: 'Connect your Xero accounting software to sync payroll and expense data.', steps: ['Navigate to Admin > Integrations from the sidebar.', 'The Xero card is always available as part of the Core subscription — no additional add-on is required.', 'Click Configure on the Xero card to expand settings.', 'Enter your Xero API credentials (Client ID and Client Secret) from your Xero Developer App.', 'Click Connect. Once authenticated, payroll and expense data can be synced to Xero.', 'Use the Sync Now button to trigger a manual sync, or enable automatic syncing on a schedule.'], callout: { type: 'tip', text: 'Xero integration is included in the Core subscription at no extra cost for all companies.' } },
      { title: 'Sage Integration (Core)', purpose: 'Connect your Sage accounting software for payroll and expense synchronisation.', steps: ['Navigate to Admin > Integrations from the sidebar.', 'The Sage card is always available as part of the Core subscription — no additional add-on is required.', 'Click Configure on the Sage card to expand settings.', 'Enter your Sage API credentials and connect your Sage account.', 'Once connected, payroll and expense data can be synced to Sage.'], callout: { type: 'tip', text: 'Sage integration is included in the Core subscription at no extra cost for all companies.' } },
      { title: 'Microsoft Teams Integration (Pack B)', purpose: 'Enable Teams notifications for leave, expenses, and other HR workflows, plus live presence indicators in the People Directory.', steps: ['Navigate to Admin > Integrations from the sidebar.', 'The Teams card requires a Pack B subscription. If your company does not have Pack B, the card shows "Pack B subscription required" and is disabled.', 'Click Configure on the Teams card to expand settings.', 'Enter your Azure Tenant ID, Bot App ID, and Bot App Secret from your Azure Active Directory app registration.', 'Click Save Configuration, then toggle the integration on.', 'Once enabled, managers receive Teams messages when employees submit leave requests or expense claims.', 'The People Directory in the employee HR app shows live Microsoft Teams presence indicators (Available, Away, Busy, Do Not Disturb, Offline) next to each colleague.'], callout: { type: 'note', text: 'Teams Integration requires an Azure AD app registration with the Presence.Read.All and User.Read.All Microsoft Graph permissions configured as Application (not Delegated) permissions.' } },
      { title: 'Email Notifications (Core)', purpose: 'Automated email alerts for HR workflow events are included in the Core subscription.', steps: ['Email notifications are enabled by default for all companies as part of the Core subscription.', 'Employees receive email alerts for leave approvals/rejections, expense status changes, shift assignments, and other HR events.', 'Managers receive email notifications when employees submit requests that need approval.', 'Email notification preferences can be configured from Admin > Notifications.'], callout: { type: 'tip', text: 'Email notifications work alongside in-app notifications. If Teams Integration is also enabled, managers receive notifications via email, in-app, and Microsoft Teams.' } },
    ],
  },
  {
    icon: '🔒', title: 'GDPR & Data Privacy',
    features: [
      { title: 'Employee Consent Management', purpose: 'Manage GDPR-compliant consent records for features that use personal data (e.g. geolocation for weather and check-in).', steps: ['Employee consent is collected in-app when an employee first uses a feature that requires personal data.', 'For geolocation: when an employee enables the weather widget or checks in with location tracking, they are prompted to grant consent.', 'Consent records are stored with a timestamp and can be withdrawn by the employee at any time from their Settings page.', 'Withdrawn consent immediately disables the feature for that employee — e.g. the weather widget disappears from their dashboard.'] },
      { title: 'GDPR Document Storage', purpose: 'Store and manage GDPR-related documents (privacy policies, data processing agreements, consent records).', steps: ['GDPR Document Storage is included in the Core subscription.', 'Navigate to the relevant admin section to upload and manage compliance documents.', 'All documents are stored securely and scoped to your company — other companies cannot access them.'] },
      { title: 'Data Retention & Deletion', purpose: 'Manage employee data lifecycle in compliance with data protection regulations.', steps: ['The Offboarding workflow includes a 30-day freeze period before employee data is permanently deleted.', 'During the freeze, the employee cannot sign in but their data is preserved and can be recovered.', 'After the 30-day period, click Delete to permanently remove all employee data.', 'All deletion actions are logged in the GDPR audit trail.'], callout: { type: 'note', text: 'Data deletion is irreversible. Export employee data before deletion if you need to retain records for legal or compliance purposes.' } },
    ],
  },
  {
    icon: '💳', title: 'Billing',
    features: [
      { title: 'View Subscription & Costs', purpose: 'See a breakdown of your company\'s InflowHR subscription and download invoices.', steps: ['Navigate to Admin > Billing from the sidebar.', 'The Core plan card shows your base subscription — this includes Leave, Performance, E-Learning, Expenses, Onboarding/Offboarding, Payroll (Xero/Sage), Kudos, Announcements & Notifications, Benefits, GDPR Document Storage, Timesheets, HR Tickets, and Email Notifications.', 'Add-on packs are listed separately: Pack A (Workforce & Operations — Shifts & Rotas, Legal Timesheets, Space & Desk Booking, Asset Management) and Pack B (Enterprise Integrations — Teams & Presence, Skills Passport & Talent Intelligence).', 'The pricing table lists each enabled feature module with its per-user monthly cost.', 'View your total employee count and calculated monthly total (net + 20% VAT).', 'Monthly invoice history is listed below — click any invoice to download the PDF.', 'Trial companies are indicated with a Trial badge next to the company name. All features are set to £0 during the trial period.'], callout: { type: 'note', text: 'Feature activation and pricing changes are managed by the InflowHR platform team. Contact your account manager to adjust your subscription or add Pack A or Pack B.' } },
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
      { title: 'Create a Company', purpose: 'Register a new tenant on the platform.', steps: ['Navigate to Admin > Subscriptions > Companies.', 'Tap + Register New Company.', 'Choose the authentication mode: SSO (Microsoft) or Non-SSO.', 'For SSO companies, enter the company name and email domain (e.g. acme.co.uk).', 'For Non-SSO companies, enter the company name only — a unique login username and password are generated automatically.', 'Optionally upload a company logo and configure trial settings.', 'Tap Register Company. The company is created with default leave types, feature settings, and a welcome announcement.'], callout: { type: 'tip', text: 'Non-SSO companies receive auto-generated login credentials displayed in a one-time modal. Save these securely — the password cannot be retrieved later. Employees of Non-SSO companies are identified by a unique Employee ID instead of a work email.' } },
      { title: 'Manage Trial Companies', purpose: 'Monitor and manage companies on a free trial period.', steps: ['The companies list shows a Trial badge with the trial end date for active trials, or a Trial Expired badge once the end date has passed.', 'Trial companies have all features (including add-ons) enabled at £0 — this is reflected in the Billing page with a Trial badge next to the company name.', 'To convert a trial company to a paid subscription, navigate to Subscriptions > Features, select the company, and update feature prices from £0 to the standard rate.', 'To extend a trial, update the trial_end_date directly in the database.'], callout: { type: 'note', text: 'Trial status is set at registration and cannot be toggled from the admin UI after creation. Contact a super admin if you need to modify trial dates.' } },
      { title: 'Edit & Deactivate Companies', purpose: 'Update company details or disable access.', steps: ['Click the Edit button on a company row to change the company name or domain.', 'Click the logo cell to upload or change a company logo. Click the X to remove it.', 'Toggle Active off to deactivate the entire company. All employees lose access immediately.', 'Toggle Login Disabled to temporarily block sign-in without deactivating.'], callout: { type: 'note', text: 'Deactivating a company does not delete any data. Reactivation restores full access.' } },
      { title: 'Manage Company Admins', purpose: 'Add or remove multiple admin users for each company. Admin employees see the "Go to Admin Portal" button in their HR app Settings page.', steps: ['In the Company Admins column, existing admins are listed by name.', 'Click + Add Admin to open the employee selector. Only active, onboarded employees are shown.', 'Select an employee to grant them admin access. Their company_users role is set to admin and they can access the Admin Portal immediately.', 'Click the X button next to any admin\'s name to remove their admin access.', 'Multiple admins can be assigned per company — there is no limit.'], callout: { type: 'tip', text: 'Removing an admin does not deactivate their employee account — it only revokes their access to the Admin Portal.' } },
      { title: 'Export, Import & Archive', purpose: 'Manage company data lifecycle.', steps: ['Export — downloads a CSV of all company data for the current financial year.', 'Import — upload a previously exported CSV to restore data into a company.', 'Archive — saves company FY data to the documents folder, with an optional delete of the source data after archiving.'] },
      { title: 'Non-SSO Companies', purpose: 'Companies that bypass Microsoft SSO and use username/password authentication.', steps: ['When registering a new company, switch the Authentication toggle to Non-SSO.', 'The email domain field is hidden — it is not required for Non-SSO companies.', 'On registration, a unique username and password are auto-generated and displayed in a modal.', 'The company admin uses these credentials with the Emergency Access login form on the sign-in page.', 'When adding employees to a Non-SSO company, a Unique Employee ID is required instead of a work email.', 'This Employee ID is used to identify employees across all HR features (leave, expenses, timesheets, etc.).', 'The companies list shows an SSO or Non-SSO badge in the Auth column for each company.'], callout: { type: 'note', text: 'Non-SSO credentials are shown only once at registration. If lost, a super admin must reset them via the database. The login account username is stored on the company record for reference.' } },
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
  {
    icon: '🌱', title: 'Demo Seed',
    features: [
      { title: 'Reset & Seed Demo Data', purpose: 'Wipe all data and repopulate the platform with demo companies and employees for testing or demonstrations.', steps: ['Navigate to Admin > Demo Seed from the sidebar.', 'Read the warning — this action deletes ALL existing data across all companies.', 'Click Run Demo Seed and confirm the dialog.', 'The system creates 2 demo companies with 11 employees, complete with leave, expenses, payslips, shifts, timesheets, kudos, and other sample data.', 'Your super admin login is preserved through the reseed.'], callout: { type: 'note', text: 'This is a destructive action. Only use it on staging or demo environments — never on a production instance with real customer data.' } },
    ],
  },
  {
    icon: '🛡️', title: 'Support Access',
    features: [
      { title: 'Grant Support Access', purpose: 'Temporarily grant the InflowHR support team read access to a company\'s data for troubleshooting.', steps: ['Navigate to Admin > Support Access from the sidebar.', 'Select a company and scope of access (restricted data or configuration only).', 'Set an expiry period and provide a reason for the access grant.', 'The grant is logged with an audit trail showing who granted it, when, and why.'] },
      { title: 'Manage Active Grants', purpose: 'View, extend, or revoke existing support access grants.', steps: ['The Support Access page lists all active and expired grants with company, scope, expiry date, and status.', 'Click Revoke to immediately terminate an active grant.', 'Expired grants are kept in the list for audit purposes.'], callout: { type: 'tip', text: 'All support access is time-limited and audited. Grants cannot be self-assigned — a super admin must create them.' } },
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
      text: 'Sign in with your company Microsoft or Google account, or with the account credentials provided by your administrator. Your dashboard shows quick-access cards for every feature your company has enabled. Use the bottom navigation bar to jump between pages:',
      bullets: ['Home — your personalised dashboard', 'Time Off — leave balances and requests', 'Directory — search colleagues', 'Notifications — announcements, actions and reminders', 'Settings — language, theme and feature visibility'],
      callout: { type: 'tip', text: 'InflowHR is a progressive web app. On mobile, use your browser\'s "Add to Home Screen" option for a native app experience.' },
    },
    admin: {
      title: 'Getting Started',
      text: 'Access the Admin Portal from Settings > Go to Admin Portal, or navigate to /admin directly. The sidebar lists every module your company has enabled.',
      bullets: ['Dashboard — at-a-glance stats: total employees, pending leave, open expenses, tickets, and more.', 'Sidebar — modules are grouped and only shown if the feature is active for your company.', 'Company Selector — Super Admins see a company dropdown in the top bar. All admin pages reflect the selected company\'s data, settings, and integrations.'],
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
