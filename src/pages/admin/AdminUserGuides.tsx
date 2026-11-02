import { useState, useMemo } from 'react'
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
      { title: 'Cancel Approved Leave', purpose: 'Withdraw an approved leave request before the leave date.', steps: ['Navigate to Time Off and find the approved request you want to cancel.', 'Tap the request to open it, then tap Cancel Request.', 'Confirm the cancellation. Your leave balance is automatically restored and your manager is notified.'], callout: { type: 'note', text: 'You can only cancel leave that has not yet started. Once the leave period begins, contact your admin to make changes.' } },
      { title: 'Shift Conflict Blocking', purpose: 'Leave requests are blocked when you have assigned shifts on the requested dates.', steps: ['When requesting leave, the system checks your published rota for shift conflicts on the requested dates.', 'If a conflict is found, a warning banner lists the affected shifts with dates and times.', 'You cannot submit the request until the conflicts are resolved — swap or remove the affected shifts first.', 'This applies to all worker types: employed, shift workers, and zero hours staff.'], callout: { type: 'note', text: 'If you are already checked in and working today, you also cannot submit a leave request for today. The system blocks submission with a message explaining you are already working.' } },
      { title: 'Zero Hours Holiday Pay (Rolled-Up)', purpose: 'If you are a zero hours worker on the rolled-up method, your holiday pay is included as an uplift on each payslip.', steps: ['Your Time Off page shows an information card explaining that your holiday pay is included on your payslips as a percentage uplift (typically 12.07%).', 'You can still book annual leave for record-keeping — this tracks who is off and when, but no balance is deducted.', 'Check your payslips for the "Holiday Pay Uplift" line item showing the exact amount added each pay period.'], callout: { type: 'tip', text: 'The 12.07% rate is the UK statutory minimum (5.6 weeks / 46.4 weeks). Your company may set a higher rate for enhanced contractual holiday.' } },
      { title: 'Zero Hours Holiday Accrual', purpose: 'If you are a zero hours worker on the accrual method, you build up paid leave hours based on hours worked.', steps: ['Your Time Off page shows your accrued hours balance — total accrued, used, and remaining.', 'Hours accrue automatically each pay period based on your hours worked (typically 12.07% of hours worked).', 'When booking annual leave, enter the number of hours you want to take off. The system checks your accrued balance.', 'Your leave balance updates after each pay run — check back after payday to see newly accrued hours.'] },
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
      { title: 'View Payslips', purpose: 'Access your payslip breakdown for each pay period.', steps: ['Navigate to Home > Payslips.', 'Payslips are listed by financial-year month. Tap any month to expand the full breakdown: gross pay, tax, National Insurance, pension, and net pay.', 'If you are paid weekly or bi-weekly, multiple payslips may appear within a single month — each showing the specific period dates (e.g. 01/10/2026 – 07/10/2026).', 'Shift and zero-hours workers see hours worked and hourly rate alongside the gross pay calculation.'] },
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
    icon: '📝', title: 'Surveys & Feedback',
    features: [
      { title: 'View Available Surveys', purpose: 'Complete surveys deployed by your HR team to share feedback on your workplace experience.', steps: ['Navigate to Home > Surveys.', 'Active surveys are listed with the title, description, and deadline.', 'Tap a survey to open it and begin responding.'] },
      { title: 'Submit a Response', purpose: 'Answer survey questions and submit your feedback.', steps: ['Open a survey and work through each question — types include rating scales, multiple choice, and free text.', 'Tap Submit when all required questions are answered.', 'Your response is anonymous unless the survey creator has specified otherwise.'], callout: { type: 'note', text: 'Once submitted, responses cannot be edited. Take your time before submitting.' } },
      { title: 'Survey History', purpose: 'See which surveys you have completed and which are still open.', steps: ['The Surveys page shows a Completed tab listing all surveys you have already responded to, with the date you submitted.'] },
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
    icon: '💬', title: 'Employee Help',
    features: [
      { title: 'Ask a Question', purpose: 'Get instant answers to common HR questions using the help chat.', steps: ['Tap the help chat icon (bottom-right of the screen) to open the assistant.', 'Type your question in plain English (up to 500 characters) — for example, "How many days leave do I have?" or "How do I submit an expense?".', 'The assistant searches your company\'s knowledge base and returns the most relevant answer.', 'If an exact FAQ article is found, the answer appears instantly. If not, an intelligent assistant generates a helpful response based on your company\'s HR policies and articles.', 'Tap any article card to expand the full answer. For data-aware questions (leave balance, next shift, last payslip), your personal data is resolved in real time.'], callout: { type: 'tip', text: 'The assistant only uses your company\'s own HR articles and policies to answer questions — it never invents answers or makes up policies.' } },
      { title: 'Quick Topics', purpose: 'Browse common topics when you\'re not sure what to ask.', steps: ['If the assistant cannot find a match, it shows quick-topic chips for common categories (Leave, Pay, Shifts, Benefits, etc.).', 'Tap a chip to see all articles in that category.', 'You can also type "show topics" to see the full list of available categories.'] },
      { title: 'Data Privacy', purpose: 'Your personal data stays private and secure.', steps: ['When the assistant answers a data-aware question (e.g. your leave balance), it reads your data directly from your company\'s secure database — no personal information is shared with any external service.', 'Only the question text and general HR article content are used to find an answer. Your name, leave balance, payslip details, and other personal data are never sent outside the platform.', 'All queries are logged for your company\'s analytics, but only the question text is stored — not the answer content or any personal data.'], callout: { type: 'note', text: 'The Employee Help assistant is fully GDPR-compliant. No employee personal data leaves the InflowHR platform.' } },
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
      { title: 'Delegate Your Approvals', purpose: 'Temporarily assign your approval responsibilities to a colleague while you are away (e.g. holiday, secondment).', steps: ['Navigate to Settings > Approval Delegation.', 'Tap + New Delegation.', 'Select the team member who will cover your approvals from the colleague picker.', 'Set the start and end dates for the delegation period.', 'Choose the scope: All (leave, expenses, timesheets) or select specific types.', 'Optionally add a reason (e.g. "Annual leave 01/11/2026 – 14/11/2026").', 'Tap Save. Your delegate receives a notification confirming the delegation.', 'During the delegation period, your pending approvals appear in the delegate\'s Actions tab alongside their own.', 'You can cancel an active delegation at any time from the same page.'], callout: { type: 'note', text: 'Delegations do not remove your own access — you can still approve requests during the delegation period. The delegate sees the same requests you would, labelled "On behalf of [your name]".' } },
      { title: 'Covering for a Colleague', purpose: 'When a colleague delegates their approvals to you, their pending items appear in your Actions tab.', steps: ['You receive a notification when a delegation starts: "[Name] has delegated approvals to you from DD/MM/YYYY to DD/MM/YYYY".', 'Open Notifications > Actions. Delegated items show a banner: "On behalf of [Name]".', 'Approve or reject as normal — the original requester is notified as if their manager actioned it.', 'The delegation ends automatically on the end date. No action is needed from you.'] },
    ],
  },
]

const ADMIN_SECTIONS: GuideSection[] = [
  {
    icon: '📊', title: 'Dashboard',
    features: [
      { title: 'Admin Dashboard Overview', purpose: 'At-a-glance summary of all HR activity across your company, accessible from the Admin sidebar.', steps: ['Navigate to Admin > Dashboard (the default landing page when entering the Admin Portal).', 'Stat cards show key metrics: Total Employees, New Onboarders, Benefits Enrolled, Shifts & Rotas, Legal Timesheets, Performance 1:1s, Space Bookings, Announcements, Tickets Raised, Pending Expenses, Pending Leave, and Kudos Given.', 'Click any stat card to jump directly to the relevant admin page.'], callout: { type: 'note', text: 'Super Admins see a different, platform-wide dashboard with 15 metric cards, sparkline trend charts, and 6-month trend data across all companies. See the Super Admin tab for details.' } },
      { title: 'Expense Export Warning', purpose: 'An orange warning banner appears when expense exports are overdue.', steps: ['If no expense export has been run in 25+ days (or ever), a warning banner appears above the stat cards.', 'Click the banner to navigate directly to Admin > Expenses > Exports tab.'], callout: { type: 'note', text: 'This warning ensures company admins stay on top of regular expense processing. It is visible to all admins.' } },
    ],
  },
  {
    icon: '👥', title: 'Employees',
    features: [
      { title: 'View & Search Employees', purpose: 'Browse and filter the full employee roster for your company.', steps: ['Navigate to Admin > Employees from the sidebar.', 'Use the search bar to find employees by name or email.', 'Filter by department using the dropdown, or toggle between active and inactive employees.', 'Click any employee row to expand their full profile — job title, department, contract type, contact details, address, and emergency contacts.'] },
      { title: 'Add an Employee', purpose: 'Manually register a new team member who can then sign in to the HR app.', steps: ['Click + Add Employee at the top of the page.', 'Enter first name, last name, email, job title, department, and contract type.', 'Set their role: Employee, Admin, or HR.', 'Click Save. The employee can now sign in with their company Microsoft account and the HR app will be available to them.'] },
      { title: 'Edit Employee Details', purpose: 'Update any employee\'s profile information. Some fields may be locked when InflowOnboarder (JML) is active.', steps: ['Click the edit icon on any employee row to open inline editing.', 'Modify name, email, contract type, or role.', 'Upload or change the employee\'s profile photo.', 'Toggle "Company Device" on or off — this controls whether persona changes are available for the employee. Only employees with a managed Entra ID device should have this enabled.', '', 'JML Field Locking (when InflowOnboarder is connected):', 'When the InflowOnboarder integration is active, the following fields are locked on the employee edit form: job title, department, location, manager name, and manager email.', 'An amber banner explains: "Job title, department, location and manager are locked — use the Mover workflow in JML to change these fields so that M365 and HR records stay in sync."', 'Locked fields show a lock icon with "Mover workflow" label and cannot be edited inline.', 'This ensures all role-relevant changes go through the Mover workflow, where old and new values are tracked for cancel/revert.', '', 'Without InflowOnboarder connected, all fields are editable as normal.', 'Save changes — updates are reflected in the employee\'s HR app immediately.'] },
      { title: 'Deactivate or Delete', purpose: 'Remove access or permanently delete an employee record.', steps: ['Toggle Active off to deactivate — the employee cannot sign in but all their data (leave, expenses, timesheets, etc.) is retained.', 'Click the delete icon to permanently remove the employee and cascade-delete all associated records.'], callout: { type: 'note', text: 'Deactivation is reversible; deletion is permanent. Use the Offboarding workflow (Admin > Onboard / Offboard) for a structured leaver process with a 30-day freeze period.' } },
      { title: 'Work Patterns', purpose: 'Manage contracted working day patterns and assign them to employees.', steps: ['Switch to the Work Patterns tab on the Employees page.', 'Default patterns are provided (Mon–Fri, Mon–Sat, Variable). Create custom patterns by toggling days.', 'Assign a pattern to each employee from their profile or the management tab.', 'Employees on non-contracted days see "Off Work" on their dashboard and cannot be assigned shifts on those days.'] },
      { title: 'Shift Skills on Employee Records', purpose: 'Assign shift skills to individual employees to control their shift eligibility.', steps: ['Click an employee row to expand their record.', 'Open the Shift Skills module in the employee record.', 'Tick the skills this employee holds (e.g. First Aid, Forklift, Cash Handling).', 'Click Save to update. The employee is now eligible for shifts requiring those skills.'] },
    ],
  },
  {
    icon: '🏖️', title: 'Leave',
    features: [
      { title: 'Approve or Decline Leave Requests', purpose: 'Process all pending leave requests submitted by employees in the HR app.', steps: ['Navigate to Admin > Leave from the sidebar.', 'All pending requests are listed with the employee name, leave type, dates, and current status.', 'Click Approve or Decline on each request. The employee is notified immediately in their HR app.'], callout: { type: 'note', text: 'If your company has an active Teams Integration subscription and the bot is configured, managers also receive a Microsoft Teams message when an employee submits a leave request.' } },
      { title: 'Configure Leave Types', purpose: 'Control which leave types are available to employees and whether they deduct from allowance.', steps: ['Scroll to the Leave Type Settings section on the same page.', 'Toggle "Deducts from Allowance" on or off for each type (e.g. Annual Leave deducts, Jury Duty does not).', 'Note: Sick Leave cannot be toggled — under UK law (Equality Act 2010) sick leave must never deduct from annual leave allowance. This is enforced automatically.', 'These settings apply company-wide — employees see the updated leave types immediately when requesting leave in the HR app.'], callout: { type: 'tip', text: 'Per-employee allowance overrides (e.g. giving one person extra annual leave) can be set from their individual profile in Admin > Employees.' } },
      { title: 'Configure Weekend Settings', purpose: 'Define which days are treated as weekends for leave calculations.', steps: ['Use the Weekend Settings section to configure which days count as non-working days.', 'This affects how leave duration is calculated when employees submit requests in the HR app.'] },
      { title: 'Handle Leave Cancellations', purpose: 'Review and process employee leave cancellation requests.', steps: ['When an employee cancels an approved leave request, the cancellation appears in the leave list.', 'The employee\'s leave balance is automatically restored when the cancellation is processed.', 'Review cancellations alongside new requests on the same admin Leave page.'] },
      { title: 'Shift Conflict Display', purpose: 'See shift conflicts highlighted when approving leave requests.', steps: ['When reviewing a leave request, any shift conflicts on the requested dates are displayed as a warning.', 'The warning lists the specific shifts affected, with dates and times.', 'Use this information to decide whether to approve the leave or discuss alternatives with the employee.'] },
      { title: 'Leave Analytics', purpose: 'View leave trends across the company.', steps: ['A stacked bar chart at the bottom shows approved leave by month broken down by leave type for the current financial year.'] },
      { title: 'Zero Hours Holiday Accrual Settings', purpose: 'Configure how zero hours workers accrue and receive holiday pay — rolled-up (paid on each payslip) or accrual (hours banked for paid leave).', steps: [
        'Navigate to Admin > Leave and switch to the Settings tab.',
        'Scroll to the "Zero Hours Holiday Accrual" section (marked with a UK Statutory badge).',
        '',
        'Holiday Pay Method:',
        '• Rolled-Up Holiday Pay (default) — holiday pay is added as a percentage uplift on each payslip. Simpler to administer, legal since January 2024.',
        '• Accrual (Paid Leave) — workers accrue holiday hours based on hours worked. They book paid time off against their accrued balance.',
        '',
        'Accrual Rate:',
        '• The UK statutory minimum is 12.07% (5.6 weeks / 46.4 weeks).',
        '• You can increase this for enhanced contractual holiday. Use the formula: total holiday weeks / (52 - total holiday weeks) × 100.',
        '• Example: 6 weeks holiday = 6 / 46 × 100 = 13.04%.',
        '',
        'Accrual Summary Table:',
        '• Shows each zero hours worker\'s total hours worked this year, hours accrued, hours used, and remaining balance.',
        '• Updated after each pay run.',
      ], callout: { type: 'note', text: 'Under UK Working Time Regulations 1998 (amended 2024), zero hours workers must accrue paid holiday based on hours worked. The statutory minimum is 5.6 weeks (12.07% of hours worked). InflowHR defaults to the rolled-up method.' } },
      { title: 'Zero Hours Leave Requests', purpose: 'How leave requests from zero hours workers differ from salaried staff.', steps: [
        'Zero hours workers on the accrual method book leave in hours, not days. Their requests show "X.X hrs" instead of "X days".',
        'Zero hours workers on rolled-up holiday pay can still book annual leave for record-keeping (tracking who is off). No balance is deducted.',
        'When approving leave, check the "Hours off" column for zero hours requests.',
        'The employee\'s accrued balance is displayed on their request for reference.',
      ] },
      { title: 'Zero Hours Compliance Engine', purpose: 'Monitor predictable hours eligibility, shift cancellation compensation, and pension auto-enrolment for zero hours workers — all gated behind a per-company toggle.', steps: [
        'Navigate to Admin > Leave and switch to the Zero Hours Compliance tab (visible only when the compliance toggle is enabled).',
        'Enable the engine: Admin > Leave > Settings > Zero Hours Compliance section. Toggle "Enable Zero Hours Compliance" on. Configure the cancellation notice window (48h–168h), pension threshold (default £10,000), qualifying weeks (default 12), and guaranteed hours overtime rate (default 12.07%).',
        'Predictable Hours Monitoring: the table lists all zero hours workers with their weeks of service and average weekly hours. Workers who have completed the qualifying period (default 12 weeks) are flagged as "Qualified". Click "Create Request" to open a formal predictable hours request.',
        'Predictable Hours Requests: use "Send Offer" to propose guaranteed weekly hours. The employee can accept or decline. On acceptance, the system automatically updates the employee record with guaranteed hours and pro-rates their annual leave entitlement (5.6 weeks × weekly hours).',
        'Shift Cancellation Compensation: when a manager removes a zero hours worker\'s shift within the notice window, a compensation amount is calculated (shift hours × hourly rate) and logged. The log appears in the compliance tab with payrun inclusion status.',
        'Pension Auto-Enrolment: the table shows each zero hours worker\'s year-to-date earnings against the pension threshold. Click "Mark Enrolled" when an employee reaches the threshold to record their enrolment date.',
      ], callout: { type: 'note', text: 'The compliance engine is off by default. When enabled, a dashboard alert card shows the count of workers who have qualified for predictable hours. Shift cancellation compensation is automatically included in the next payroll run.' } },
      { title: 'Guaranteed Hours Transition', purpose: 'When a zero hours worker accepts a predictable hours offer, their payroll treatment changes.', steps: [
        'After acceptance, the employee\'s record is updated: guaranteed_hours_approved = true, guaranteed_weekly_hours set to the offered amount, and a start date is recorded.',
        'Pro-rated annual leave is automatically calculated and credited: guaranteed weekly hours × 5.6 weeks.',
        'In payroll: hours up to the guaranteed weekly amount are treated as contracted. Only excess hours above the guaranteed threshold attract the zero hours holiday pay uplift (at the configurable overtime rate).',
        'Shift cancellation compensation for any cancelled shifts within the notice window is added to the payslip as "Shift Cancellation Compensation" and surfaced as a manual action item in connected payroll (Xero/Sage).',
      ], callout: { type: 'tip', text: 'The guaranteed hours overtime rate defaults to 12.07% (UK statutory minimum) and can be configured per company in the compliance settings.' } },
      { title: 'Shift Conflict & Working-Today Blocking', purpose: 'Leave submissions are now hard-blocked when employees have assigned shifts or are already working.', steps: [
        'When any employee (employed, shift worker, or zero hours) requests leave on dates with assigned shifts, the submission is blocked — not just warned.',
        'The employee sees a list of conflicting shifts and is told to swap or remove them before resubmitting.',
        'If an employee is already checked in today, they cannot submit leave for today. They see a message: "You cannot submit time off today — you are already working."',
        'These rules apply to all worker types equally.',
      ], callout: { type: 'note', text: 'Previously, shift conflicts showed a dismissible warning. They now hard-block submission to prevent scheduling errors reaching the approval queue.' } },
      { title: 'Sick Pay Policy Settings', purpose: 'Configure Company Sick Pay (CSP) and Statutory Sick Pay (SSP) for your company, with Bradford Factor monitoring and absence triggers.', steps: [
        'Navigate to Admin > Leave > Settings tab.',
        'Scroll to the "Sick Pay Policy" section (marked with a UK Statutory badge).',
        'Enable sick pay management with the toggle. This reveals the Sickness tab on the Leave page.',
        '',
        'Company Sick Pay (CSP):',
        '• Set the number of full pay days (default 10) and half pay days (default 10).',
        '• Employees receive full salary for the full pay period, then 50% for the half pay period.',
        '',
        'Statutory Sick Pay (SSP):',
        '• Weekly rate defaults to £123.25 (the current UK statutory rate).',
        '• Maximum 28 weeks of SSP.',
        '• SSP is employer-funded — you deduct it from the employee\'s normal pay and pay the SSP amount.',
        '',
        'Bradford Factor Thresholds:',
        '• Green/Amber boundary (default 50) and Amber/Red boundary (default 200).',
        '• Bradford Factor = S² × D (Spells squared × Days lost).',
        '• Higher scores indicate patterns of short frequent absences which may need intervention.',
        '',
        'Absence Triggers:',
        '• Set the number of spells within a rolling period (e.g. 3 spells in 6 months) that triggers a review.',
        '• Employees exceeding this threshold are highlighted in red on the Sickness dashboard.',
        '',
        'Fit Note Threshold:',
        '• Number of calendar days after which a fit note (GP Statement of Fitness for Work) is required (default 7 days, UK statutory).',
      ], callout: { type: 'note', text: 'UK law requires SSP to be paid to employees earning at least the Lower Earnings Limit (£123/week). Zero hours workers may not qualify if their average earnings fall below this threshold.' } },
      { title: 'Sickness Dashboard', purpose: 'Monitor all employee sickness absence with Bradford Factor scores, sick pay status, and fit note tracking.', steps: [
        'Navigate to Admin > Leave > Sickness tab (visible when sick pay management is enabled).',
        'The dashboard table shows each employee with sickness absence this financial year:',
        '• Days Lost — total working days lost to sickness.',
        '• Spells — number of separate sickness episodes (a spell is a continuous period of absence).',
        '• Bradford Score — S² × D with RAG colour coding (Green/Amber/Red based on your thresholds).',
        '• Sick Pay Status — dropdown to manually set each employee\'s pay status: Normal, CSP Full, CSP Half, SSP, or Unpaid.',
        '• SSP Progress — visual progress bar showing X/28 weeks of SSP used.',
        '• Fit Note — shows "Required" (amber) when a fit note is needed but not received, "Received" (green) when submitted.',
        '',
        'Click the arrow on any row to expand episode details:',
        '• Each episode shows dates, working days lost, CSP/SSP usage, and checkboxes for fit note and return-to-work.',
        '• Mark "Return to work" to close the episode and record the date automatically.',
      ], callout: { type: 'tip', text: 'The sick pay status dropdown is the key admin action. Payroll reads this flag to adjust pay. When an employee exhausts CSP, the system sends a notification to their manager to review and update the status.' } },
      { title: 'Managing Sick Pay Status', purpose: 'Understand the manual workflow for transitioning employees between sick pay phases.', steps: [
        'When an employee goes sick, they start at "Normal" (no sick pay deduction).',
        'As they use CSP days, update their status to "CSP Full" then "CSP Half" as appropriate.',
        'When CSP is exhausted (based on your configured days), the system notifies the employee\'s manager to review.',
        'Set to "SSP" when the employee transitions to statutory sick pay — payroll will deduct full day\'s pay and add back the SSP daily rate.',
        'After 28 weeks of SSP, set to "Unpaid" — the employee receives no sick pay.',
        'When the employee returns to work, set back to "Normal" and mark the episode\'s return-to-work checkbox.',
        '',
        'Worker type differences:',
        '• Salaried: Eligible for CSP and SSP. Daily rate = annual salary / (periods × working days).',
        '• Shift workers: Eligible for CSP and SSP. Daily rate from hourly rate × contracted hours / contracted days.',
        '• Zero hours: Company discretion on CSP. SSP only if earning ≥ £123/week averaged over 8 weeks.',
      ], callout: { type: 'note', text: 'Under the Equality Act 2010, disability-related absence must be considered separately from general sickness monitoring. The Bradford Factor should not be the sole basis for action — always consider individual circumstances, especially for long-term health conditions.' } },
      { title: 'Worked Example: Sick Pay From Start to Finish', purpose: 'A step-by-step walkthrough of how sick pay works in practice, from an employee calling in sick through to their payslip.', steps: [
        'Imagine your company has the default settings: 10 days full pay, then 10 days half pay, then SSP.',
        '',
        'Week 1 — Employee calls in sick:',
        '• Sarah emails her manager to say she is unwell and submits a Sick Leave request in the system for 3 days (Monday to Wednesday).',
        '• Her manager approves the request in Admin > Leave.',
        '• The system automatically creates a sickness episode and records 3 days lost. Sarah\'s pay is not affected yet — she is within her full pay allowance.',
        '• Because it is fewer than 7 days, Sarah does not need a fit note (GP\'s note). She can self-certify.',
        '',
        'Week 3 — Sarah is sick again:',
        '• Sarah submits another Sick Leave request for 5 days (a full week).',
        '• Her manager approves it. The system now records 8 days lost across 2 spells.',
        '• The Sickness dashboard shows her Bradford Factor as 2² × 8 = 32 (Green — within the default threshold of 50).',
        '• Because this spell is 5 days, she still does not need a fit note (threshold is 7 calendar days).',
        '',
        'Month 2 — A longer absence:',
        '• Sarah goes off sick for 2 weeks (10 working days). Her manager approves the request.',
        '• Total days lost is now 18. The system detects she is within 2 days of exhausting her 20 CSP days (10 full + 10 half).',
        '• Her manager receives a notification: "Sarah has used 18 of 20 Company Sick Pay days. Please review and update their sick pay status."',
        '• A task also appears in the manager\'s My Actions on the Dashboard.',
        '• Because this spell exceeds 7 calendar days, the Sickness dashboard shows "Fit Note Required" in amber. The manager should ask Sarah to provide a fit note from her GP.',
        '',
        'What the manager does next:',
        '• The manager goes to Admin > Leave > Sickness tab.',
        '• They click Sarah\'s row to expand her episode details and tick the "Fit note received" checkbox once Sarah provides it.',
        '• They change Sarah\'s Sick Pay Status dropdown from "Normal" to "CSP Half" (since she has used her 10 full pay days).',
        '• If Sarah remains off sick beyond 20 days total, the manager changes her status to "SSP".',
        '',
        'At payroll time:',
        '• When the admin runs payroll, Sarah\'s payslip is automatically adjusted based on her current status.',
        '• If set to "CSP Half", half of each sick day\'s pay is deducted. If set to "SSP", her full day\'s pay is deducted and £24.65 per day (the SSP daily rate) is added back.',
        '• The payslip shows the sick pay type and amount so Sarah can see exactly what happened.',
        '',
        'When Sarah returns to work:',
        '• The manager goes to the Sickness tab, expands Sarah\'s episode, and ticks "Return to work completed".',
        '• They change her Sick Pay Status back to "Normal".',
        '• From the next pay run, Sarah\'s pay returns to her full salary.',
      ], callout: { type: 'tip', text: 'The key action for managers is changing the Sick Pay Status dropdown. The system tells you when to review it, but you decide when to move an employee from full pay to half pay to SSP. Always consider individual circumstances before making changes.' } },
      { title: 'Sick Pay in Payroll', purpose: 'How sick pay adjustments appear in the payroll wizard.', steps: [
        'When generating payslips, employees with a sick pay status other than "Normal" have their pay adjusted automatically.',
        '• CSP Full — no deduction, employee receives normal salary.',
        '• CSP Half — 50% of a day\'s pay deducted per sick day in the period.',
        '• SSP — full day\'s pay deducted, SSP daily rate (£123.25 / 5 qualifying days = ~£24.65/day) added back.',
        '• Unpaid — full day\'s pay deducted, nothing added back.',
        'The payslip shows the sick pay amount, type, and number of sick days in the period.',
        'Employee payslips display "Company Sick Pay" or "Statutory Sick Pay (SSP)" with the amount.',
      ] },
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
      { title: 'A Typical Month — End-to-End Payroll', purpose: 'A walkthrough of the complete monthly payroll cycle for a company with salaried employees, shift workers, and zero-hours staff — from time recording through to payslip release.', steps: [
        'WEEK 1–4: TIME RECORDING (happens automatically throughout the month)',
        '• Salaried employees submit timesheets via the InflowHR app, or clock in/out if check-in is enabled.',
        '• Shift workers and zero-hours staff clock in and out of their assigned shifts using the app.',
        '• Each clock-out automatically creates a timesheet entry with net hours (break time subtracted).',
        '• Admins can view these entries in Admin > Timesheets — each shows a source badge: Clock-in (green), Manual (blue), or Adjusted (orange).',
        '',
        'AROUND 25TH OF THE MONTH: APPROVE TIMESHEETS',
        '• Go to Admin > Timesheets. Filter by Pending status.',
        '• Review hours for each employee. Approve or reject entries.',
        '• If a shift worker flagged a correction (wrong check-in/out time), handle it in Admin > Shifts & Rotas > Corrections — approved corrections automatically update the linked timesheet.',
        '',
        'LAST WORKING DAY: RUN THE PAYROLL WIZARD',
        '• Go to Admin > Payroll and click Run Payroll (or continue from the Payslips tab).',
        '',
        'Step 1 — Select Workers: Tick which worker types to include (Employed, Shift Workers, Zero Hours). Select the pay period.',
        'Step 2 — Review: InflowHR shows each employee\'s gross pay, auto-calculated overtime, and TOIL credits. Overtime is calculated by comparing approved timesheet hours against contracted weekly hours. You can adjust any figure before proceeding.',
        'Step 3 — Generate: Click Generate Payslips. InflowHR creates a pay run record and generates payslips for every selected employee. Tax and NI are calculated using the correct frequency (weekly, bi-weekly, or monthly). Benefits are prorated. TOIL employees get lieu days credited to their leave balance automatically.',
        'Step 4 — Export: Choose your payment method and click Export:',
        '  • BACS — downloads a Standard 18 CSV with employee bank details and net pay. Upload this to your bank.',
        '  • Xero — pushes payroll data to your connected Xero account.',
        '  • Sage CSV — downloads a Sage-format CSV for import into Sage payroll.',
        '  • Modulr — triggers Faster Payments directly to employee bank accounts.',
        '  • External — marks the run as managed outside InflowHR.',
        'Step 5 — Sync & Release:',
        '  • If using Xero: click Fetch Pay Run to pull back Xero\'s actual tax/NI calculations and update payslips.',
        '  • If using Sage: import the Sage results or confirm externally.',
        '  • Once satisfied, click Release to Employees. This changes payslip status to Paid and makes them visible in the employee app.',
        '',
        'AFTER RELEASE: WHAT EMPLOYEES SEE',
        '• Employees see their payslip under My Payslips in the app — only after you release.',
        '• Draft and processing payslips are hidden from employees until release.',
        '• The pay run is recorded in the Logs tab for audit purposes.',
      ], callout: { type: 'note', text: 'InflowHR calculates gross pay, overtime, and TOIL. Your Sage or Xero account handles the HMRC tax engine (PAYE, NI, pension, RTI submissions). InflowHR does not submit RTI — this is done by your HMRC-certified payroll provider.' } },
      { title: 'Run Payroll Wizard — Connected Mode (Xero/Sage)', purpose: 'The 5-step wizard when your company has Xero or Sage connected. InflowHR collects overtime, unpaid leave, and benefit changes — then pushes variable hours to your provider and guides you through manual items it cannot push.', steps: [
        'Navigate to Admin > Payroll from the sidebar and click Run Payroll.',
        'The wizard detects your active Xero or Sage integration and enters Connected mode automatically.',
        '',
        'STEP 1 — SELECT WORKERS',
        'Tick which worker types to include: Employed, Shift Workers, Zero Hours.',
        'Set the pay period. The wizard calculates the next month automatically.',
        '',
        'STEP 2 — COLLECT ADJUSTMENTS',
        'InflowHR loads all adjustment data for the period:',
        '• Overtime hours — auto-calculated from approved timesheets vs contracted hours. You can adjust any figure.',
        '• TOIL credits — employees on TOIL handling get lieu days credited to their leave balance (no pay push).',
        '• Unpaid leave — days of unpaid leave to deduct from the pay run.',
        '• Benefit changes — new benefit enrollments, cancellations, or cost changes for the period.',
        'Review the summary panel. Expand each section to check individual employees.',
        '',
        'STEP 3 — PUSH TO PROVIDER',
        '',
        'If connected to Xero:',
        '• Click "Push N Timesheets to Xero" to send overtime and variable hours directly via the Xero API.',
        '• InflowHR pushes timesheet lines to each employee\'s auto-created Xero timesheet for the pay period.',
        '• Hours are spread across weekdays (max 8 hours per day per line) using the correct Xero earnings rate.',
        '• Earnings rates are auto-detected from your Xero account and cached (Regular Hours, Overtime).',
        '• After pushing, you see a results table: each employee with hours, rate, amount, and a Pushed or Failed badge.',
        '• Skipped employees (e.g. no Xero mapping, no timesheet in Xero) are listed with the reason.',
        '',
        'Items InflowHR CANNOT push to Xero (shown as "Manual action needed"):',
        '• Unpaid leave — shown with days and estimated deduction. Go to Payroll > Employees in Xero to apply.',
        '• Benefit additions/deductions — shown with the benefit name, type, and monthly cost. Add via Payroll > Pay Items in Xero.',
        '• Holiday pay for zero hours workers — shown with hours worked, hourly rate, accrual rate, and calculated amount. Add as an earnings line in your provider.',
        '• Each manual item tells you exactly where to enter it in Xero or Sage.',
        '',
        'If connected to Sage:',
        '• Click "Export Adjustments CSV" to download a Sage-format CSV with all adjustment data.',
        '• Import the CSV into Sage Payroll. The file includes employee names, adjustment types, hours, rates, and amounts.',
        '',
        'STEP 4 — SYNC BACK FROM PROVIDER',
        'After you have run the pay run in Xero or Sage (including applying any manual items):',
        '',
        'Xero: Click "Fetch Pay Run" to pull the completed payslips back into InflowHR.',
        '• InflowHR fetches the most recent posted pay run from Xero.',
        '• Each payslip\'s actual tax, NI, deductions, pension, and net pay are pulled and stored.',
        '• Employees are matched by their Xero employee ID (or by email on first sync — the mapping is saved).',
        '• Payslips are created in InflowHR with source "Xero" and status "Paid".',
        '• Any unmatched employees (in Xero but not in InflowHR) are reported.',
        '',
        'Sage: Upload the processed payslip PDFs from Admin > Payslips, or click "Go to Payslips to Upload".',
        '',
        'STEP 5 — RELEASE TO EMPLOYEES',
        'Review the synced payslips. Click "Release to Employees" to make them visible in the employee app.',
        'Released payslips show under My Payslips with the actual figures from your payroll provider.',
      ], callout: { type: 'note', text: 'In Connected mode, InflowHR does NOT run tax/NI calculations or submit RTI. Your Xero or Sage account handles PAYE, NI, pension, and HMRC submissions. InflowHR pushes overtime hours and flags manual items — it does not push deductions, benefits, or unpaid leave via the API.' } },
      { title: 'Run Payroll Wizard — Standalone Mode', purpose: 'The 5-step wizard when no payroll provider is connected. InflowHR generates estimate payslips with approximate tax/NI — these are not HMRC-certified.', steps: ['Navigate to Admin > Payroll from the sidebar and click Run Payroll.', 'If no Xero or Sage integration is active, the wizard enters Standalone mode automatically.', 'Step 1 — Select Workers: Choose which worker types to include and set the pay period.', 'Step 2 — Review: Check auto-calculated gross pay, overtime hours, and TOIL credits per employee. Adjust any values if needed.', 'Step 3 — Generate Estimates: Click Generate Estimate Payslips. A prominent disclaimer confirms these are estimates only — not HMRC-certified. Tax and NI are calculated using simplified HMRC 2024/25 bands.', 'Step 4 — Export: Select a payment method (BACS CSV, Modulr, or External) and export. Xero and Sage options are not available in standalone mode.', 'Step 5 — Sync & Release: Review estimates and click Release to Employees. Payslips display an "Estimate" badge in the employee app.'], callout: { type: 'note', text: 'Standalone payslips carry a visible disclaimer: "These figures are estimates only — not produced by an HMRC-certified payroll engine." Connect Xero or Sage via Admin > Integrations for certified payroll.' } },
      { title: 'Check-In to Timesheet Bridge', purpose: 'Understand how employee clock-ins automatically create timesheet entries for payroll.', steps: ['When an employee clocks out (via Timesheet Check-In or Shift Check-In), InflowHR automatically creates a timesheet entry.', 'The timesheet captures: date, start time, end time, net hours (total time minus breaks), and links back to the check-in record.', 'These entries appear in Admin > Timesheets with a green "Clock-in" source badge.', 'Admins approve these timesheets just like manual entries — approved hours feed into the payroll wizard.', 'If a shift correction is approved in Admin > Shifts & Rotas > Corrections, the linked timesheet is automatically updated with corrected times and an orange "Adjusted" badge.'] },
      { title: 'Overtime & TOIL', purpose: 'How InflowHR auto-calculates overtime and credits TOIL (time off in lieu) based on approved timesheets.', steps: ['Overtime is calculated automatically in Step 2 of the payroll wizard.', 'For each employee, InflowHR compares total approved timesheet hours for the period against their contracted weekly hours (set on the employee record).', 'If approved hours exceed contracted hours, the surplus is flagged as overtime.', 'What happens to overtime depends on the employee\'s overtime handling setting:', '  • Overtime: Extra hours are paid at the overtime rate (default 1.5x multiplier). The overtime pay is added to gross.', '  • TOIL: Extra hours are converted to lieu days and automatically credited to the employee\'s leave balance. No overtime pay is added.', '  • None: Overtime hours are ignored — no extra pay and no TOIL credit.', 'All auto-calculated values show an "Auto" badge. You can manually adjust any overtime figure before generating payslips.'], callout: { type: 'tip', text: 'Set overtime handling per worker type in Admin > Employees > Payroll Settings. Per-employee overrides are available on the employee\'s Pay tab.' } },
      { title: 'Payslip Release Gate', purpose: 'Control when employees can see their payslips — draft payslips are hidden until you explicitly release them.', steps: ['Payslips go through a status progression: Draft → Processed → Paid.', 'Employees can only see payslips with status Processed or Paid in their app.', 'Draft payslips (generated but not yet released) are invisible to employees.', 'To release: complete the payroll wizard through to Step 5 and click Release to Employees.', 'Releasing updates all payslips in the run to Paid status and records the pay run as Released with a completion timestamp.', 'This gives you time to review, adjust, and sync with Xero/Sage before employees see anything.'] },
      { title: 'Shift & Zero-Hours Pay — How Hours Are Collected', purpose: 'Understand how check-in records feed into payroll for shift workers and zero-hours employees.', steps: ['Shift and zero-hours employees log their hours via Check-In (clock in/out on shifts).', 'InflowHR automatically aggregates check-in records into the pay period when you run the pre-payroll wizard.', 'In Step 2 of the wizard, you will see each employee\'s total hours and gross pay calculated from their hourly rate.', 'If any employees have no check-in records for the period, the wizard will flag this and block payslip generation.', 'If hours are pending confirmation, review and approve them on the Admin > Timesheets page before running payroll.', 'Once all hours are confirmed, the wizard proceeds to generate payslips (standalone) or push to your provider (connected).'], callout: { type: 'tip', text: 'Set hourly rates and pay frequency on the Employee Pay tab first — these are used to calculate gross pay automatically.' } },
      { title: 'Employee Pay — Hourly Rate Setup', purpose: 'Configure hourly rates, pay frequency, and overtime multipliers for shift and zero-hours workers.', steps: ['Navigate to Admin > Payroll > Employee Pay.', 'Select the Shift Workers or Zero Hours sub-tab.', 'For each employee, set their Hourly Rate (e.g. £12.50), Pay Frequency (weekly, fortnightly, 4-weekly, or monthly), and Overtime Multiplier (defaults to 1.5x).', 'Changes save automatically. These values are used when generating period reviews and the payroll wizard.'] },
      { title: 'Exporting Payroll', purpose: 'Detailed guide to each payment export method. Available options depend on whether you are in Connected or Standalone mode.', steps: [
        'Connected Mode (Step 3 — Push to Provider):',
        '',
        'Xero — What gets pushed automatically:',
        '• Overtime hours and variable hours (shift workers, zero-hours workers) are pushed as timesheet lines via the Xero API.',
        '• Each employee\'s hours are added to their auto-created Xero timesheet for the pay period.',
        '• The correct earnings rate (Regular Hours or Overtime) is auto-detected from your Xero account.',
        '',
        'Xero — What you must enter manually in Xero:',
        '• Unpaid leave deductions — go to Payroll > Employees > [name] > Leave in Xero.',
        '• Benefit additions or deductions — go to Payroll > Pay Items in Xero.',
        '• InflowHR shows a "Manual action needed" table with the exact amounts and where to enter them.',
        '',
        'Sage CSV:',
        '• Downloads a Sage-compatible CSV containing all adjustment data (overtime, unpaid leave, benefits).',
        '• Import the CSV into Sage Payroll before running the pay run.',
        '',
        'Standalone Mode (Step 4 — Export):',
        '• BACS CSV: Downloads a Standard 18 format CSV with employee sort codes, account numbers, and net pay.',
        '• Modulr Payouts: Triggers Faster Payments directly to employee bank accounts (requires Pro Integrations pack).',
        '• External: Marks the pay run as managed outside InflowHR.',
      ], callout: { type: 'note', text: 'All CSV exports are protected against formula injection — special characters are sanitised to prevent spreadsheet security issues.' } },
      { title: 'Payroll Dashboard Cards', purpose: 'At-a-glance payroll status for each worker type — employed, shift workers, and zero hours.', steps: ['The Payroll page shows three dashboard cards side by side — one for each worker type.', 'Each card shows the most recent pay run status, total employees, and gross pay.', 'For shift and zero hours workers on non-monthly pay patterns, cards show the rolling schedule: "Current period (collecting)" with the active work-period dates, and "Process & pay window" with the next Mon–Fri processing dates.', 'Cards with a submitted or paid pay run show two action buttons: "Run Next Payrun" (to start the next wizard run) and "View Payslips" (to jump to the payslips tab for that worker type).'], callout: { type: 'tip', text: 'The Run Next Payrun button calculates the next period automatically from the last completed run, so you can start the next cycle with one click.' } },
      { title: 'Xero Weekday Distribution', purpose: 'Understand how shift and zero hours timesheet data is formatted for Xero.', steps: ['When pushing timesheets to Xero for shift and zero hours workers, InflowHR distributes total hours across weekdays (Monday to Friday) only.', 'Weekend hours are spread across the weekday dates within the pay period — Xero receives one line per day, capped at 8 hours per line.', 'This means the dates in Xero may not match the exact days the employee worked, but the total hours are correct.', 'If your company needs exact-day tracking in Xero, you can export the data as CSV and adjust the dates manually before importing.'], callout: { type: 'note', text: 'This distribution applies only to the Xero push. InflowHR retains the original check-in dates and times for your records.' } },
      { title: 'Zero Hours Holiday Pay in Payroll', purpose: 'How holiday pay for zero hours workers is calculated and pushed to your payroll provider.', steps: [
        'When you run a payroll that includes zero hours workers, InflowHR automatically calculates holiday pay based on the method configured in Admin > Leave > Settings.',
        '',
        'Rolled-Up Method:',
        '• Holiday pay is calculated as a percentage uplift on the worker\'s gross pay (default 12.07%).',
        '• The uplift is added to gross before tax and NI — it is taxable income.',
        '• The payslip shows a "Holiday Pay Uplift" line item with the amount.',
        '',
        'Accrual Method:',
        '• Hours accrued are calculated from hours worked × accrual rate, rounded per Acas rules (fractional hours ≥ 0.5 round up, < 0.5 round down).',
        '• Accrued hours are added to the worker\'s leave balance automatically.',
        '• No additional pay is added to the payslip — the worker takes paid leave later.',
        '',
        'Connected Mode (Xero/Sage) — Holiday Pay Manual Items:',
        '• Holiday pay CANNOT be pushed automatically via the Xero API — it appears as a manual action item in Step 3 of the payroll wizard.',
        '• Each zero hours worker with rolled-up holiday pay gets an amber "Holiday Pay" card showing:',
        '  — Employee name',
        '  — Hours worked in the period',
        '  — Hourly rate and accrual rate',
        '  — Calculated holiday pay amount',
        '  — Instructions for where to enter it in Xero or Sage',
        '• You must tick off each holiday pay item after entering it in your provider before you can proceed to Step 4.',
        '• For Sage CSV exports, the same holiday pay items appear as manual action items.',
      ], callout: { type: 'note', text: 'Holiday pay must be entered manually in Xero/Sage so that your provider calculates the correct tax and NI on the uplifted gross. InflowHR shows the exact amount — you just need to add the earnings line.' } },
      { title: 'Payroll Audit Log', purpose: 'View a GDPR-compliant audit trail of all payroll actions taken by admins.', steps: ['Navigate to Admin > Payroll and switch to the Logs tab.', 'The log records all key payroll actions automatically: payslip generation (success and failure), adjustment pushes to Xero or Sage, pay run exports (BACS, Modulr, Xero, Sage CSV), pay run completion, Xero sync, Xero CSV imports, and overtime rate changes.', 'Each entry shows the action type, admin who performed it, timestamp, status (success or error), and details including pay run ID, period dates, and employee counts.', 'Failed actions are also logged with the error message for troubleshooting.', 'Use the date range filter and search to find specific entries.', 'Export the log as CSV for compliance reporting.'], callout: { type: 'note', text: 'Audit logs are append-only and cannot be edited or deleted. They support GDPR accountability requirements for payroll data processing.' } },
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
      { title: 'New Starter E-Learning Course', purpose: 'Configure a default e-learning course that is automatically assigned to new employees during onboarding.', steps: ['Navigate to Admin > E-Learning and switch to the New Starter Course tab.', 'Toggle on "Enable New Starter E-Learning" to activate the feature.', 'Select an existing course from the dropdown, or create a new course to use as the default new starter course.', 'Set the completion deadline — the default is 7 days from the employee\'s start date.', 'The course is auto-assigned to each new employee on their start date.', 'During the onboarding workflow, the "Assign New Starter E-Learning" step automatically enrols the employee in the configured course.', 'Monitor enrolment status and completion progress from the onboarding workflow view.'], callout: { type: 'tip', text: 'Pair the new starter course with the automated welcome announcement to give new employees a clear path through onboarding — the welcome message directs them to both the User Guide and E-Learning.' } },
    ],
  },
  {
    icon: '🚀', title: 'Onboard / Offboard',
    features: [
      { title: 'Onboarding Dashboard', purpose: 'At-a-glance onboarding stats and pipeline for your company.', steps: ['Navigate to Admin > Onboard / Offboard from the sidebar.', 'The Dashboard tab shows: total starters, in-progress, due to join, overdue, and completed counts.', 'A monthly chart shows starters per month for the current financial year.', 'The pipeline view shows how many starters are at each workflow stage.'] },
      { title: 'Create a New Starter', purpose: 'Add a new employee through the structured onboarding workflow. The employee record is created and activated at the final step.', steps: ['Switch to the New Starter tab.', 'Fill in basic details: name, email, job title, department, start date, and contract type.', 'Select the employment category: Employed (Salaried), Shift Worker, or Zero Hours.', '• Selecting Zero Hours automatically sets: contract type to "Zero hours shift worker", weekly hours to 0, and leave allowance to 0 hours (accrued via payroll).', '• The leave allowance field changes to "Leave Allowance (hours — accrued)" and is read-only for zero hours workers.', 'Optionally complete personal information, address, employment history, emergency contact, and bank details.', 'Click Create & Start Workflow to begin the 8-step onboarding process.'], callout: { type: 'tip', text: 'Zero hours workers start with 0 accrued leave hours. Their holiday entitlement builds up automatically through the payroll process based on hours worked.' } },
      { title: 'Bulk Upload', purpose: 'Create multiple starters at once from a spreadsheet.', steps: ['Switch to the Bulk Upload tab.', 'Download the Excel template, fill it in with multiple starter records, and upload.', 'Review the preview table and fix any validation errors, then confirm the upload.'] },
      { title: 'Onboard Workflow', purpose: 'Track each new starter through 8 sequential onboarding steps.', steps: ['Switch to the Onboard Workflow tab (or click Workflow on any starter record).', 'Steps: Create Details → Order Equipment → Organise First Meeting → Notify Manager → Plan First Day → Inform Starter → Create Accounts & Licences → Day 1 Access Verification.', 'Mark each step complete or skip if not applicable.', 'Completing the Order Equipment step automatically sets "Company Device" to Yes on the employee record. This enables persona changes for the employee in the Movers workflow and on the employee edit form.', 'The final step (Day 1 Access) creates the employee record and activates their HR app account — they can then sign in.'] },
      { title: 'Start Offboarding', purpose: 'Begin the offboarding process for a departing employee.', steps: ['Switch to the Offboarding tab.', 'Search for the employee by name using the search bar.', 'Select the employee from the results, set their end date and reason for leaving.', 'Click Start Offboarding to create the record and begin the workflow.'], callout: { type: 'note', text: 'Only active, onboarded employees appear in the search. Employees already being offboarded are excluded.' } },
      { title: 'Offboarding Workflow', purpose: 'Guide a leaver through 5 sequential offboarding steps.', steps: ['Switch to the Offboarding Workflow tab (or click Workflow on an active offboarding record).', 'Steps: Approve Resignation (HR) → Recover Equipment → Organise Leaving Meeting (Manager) → Remove Employee Accounts/Licences → Agree/Confirm Last Payments.', 'Mark each step complete or skip if not applicable. You can undo a completed step if needed.', 'After marking the final step complete, a confirmation modal appears asking you to approve or decline freezing the employee\'s HR app account.'] },
      { title: 'Freeze & Deletion Queue', purpose: 'Frozen employees are blocked from signing in to the HR app and placed in a 30-day deletion queue.', steps: ['When you approve the freeze, the employee is immediately deactivated — they can no longer sign in to the HR app.', 'The frozen employee appears in the Deletion Queue table on the Offboarding tab with their freeze date and scheduled deletion date (30 days later).', 'Each record shows a status: Awaiting Expiry, Ready to Delete, or Recovered.', 'Click Recover to reinstate the employee — their HR app account is reactivated and they can sign in again.', 'Click Delete to permanently remove the employee record before the 30-day period.', 'If a joiner record is deleted from the onboarding pipeline, any associated frozen employee and deletion certificate records are also cascade-deleted automatically.'], callout: { type: 'tip', text: 'Recovery is available at any time before deletion. The employee\'s data is fully preserved during the 30-day freeze period.' } },
      { title: 'Cancel Offboarding', purpose: 'Remove an in-progress offboarding record before it is completed.', steps: ['On the Offboarding tab, find the employee under Active Offboarding.', 'Click the Cancel button on their record.', 'Confirm the cancellation — the offboarding record is removed and the employee remains active with full HR app access.'] },
      { title: 'Leaver Financial Calculator', purpose: 'An automated cost breakdown for departing employees — covering notice pay, accrued holiday, pension, and recruitment costs. All calculations run locally with no external API calls for GDPR compliance.', steps: [
        'When viewing an offboarding record, click the Financial Summary tab to see the leaver cost breakdown.',
        'The calculator uses the employee\'s salary (or hourly rate), contract details, and your company\'s leave policy settings to compute:',
        '• Notice period cost — based on contractual or statutory minimum notice (whichever applies).',
        '• Accrued but untaken holiday — pro-rated to the leaving date, factoring in your company\'s bank holiday treatment (included, additional, or not given) and leave payout policy.',
        '• Employer pension contribution — calculated from the employer pension rate set on your company record.',
        '• Estimated recruitment replacement cost — a configurable estimate for hiring a replacement.',
        '',
        'The summary cards at the top show: Total Cost to Company, Notice Period Cost, Holiday Payout, and Pension Cost.',
        'A detailed breakdown section shows every line item with the calculation method.',
        '',
        'Company policy settings that affect the calculation:',
        '• Bank Holiday Treatment — set in your company record: "additional" (bank holidays are on top of annual leave), "included" (bank holidays count within the allowance), or "not given" (no bank holidays).',
        '• Leave Payout Policy — "pay out" (unused leave is paid), "must take" (employee must use leave during notice), "company decides", or "mixed".',
        '• Leave Clawback Clause — if enabled, overused leave can be deducted from the final payment.',
        '• Employer Pension Rate — the percentage your company contributes (e.g. 3%).',
      ], callout: { type: 'note', text: 'All calculations are performed entirely within the app using UK Working Time Regulations 1998 and Employment Rights Act 1996 rules. No employee data is sent to any external service. The calculator is fully GDPR-compliant.' } },
      { title: 'Leaver Calculator — Missing Data Warnings', purpose: 'The calculator raises warnings when key employee data is missing, so you know which figures may be inaccurate.', steps: [
        'If the employee has no annual salary recorded (for salaried staff) or no hourly rate (for hourly staff), a yellow warning banner appears: all cost figures will show as £0.00 until the data is updated.',
        'If no contractual notice period is set and no agreed leaving date exists, a warning explains that statutory minimum notice has been used — which may not reflect the actual contract.',
        'If the employee\'s leave allowance is the default 28 days, a blue note suggests checking whether they have a different entitlement.',
        'If no weekly hours are recorded, a warning flags that hours-based figures may be inaccurate.',
        '',
        'To resolve warnings: update the employee\'s profile in Admin > Employees with their salary, hourly rate, notice period, and leave allowance. Then return to the offboarding record to see accurate costs.',
      ], callout: { type: 'tip', text: 'Ensure employee salary and contract details are up to date before starting offboarding to get the most accurate financial breakdown from the start.' } },
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
      { title: 'Department-Targeted Announcements', purpose: 'Create announcements targeted to one or more specific departments from the admin portal, so only relevant employees see them.', steps: ['Navigate to Admin > Notifications > Announcements.', 'Click Create Announcement.', 'Fill in the announcement title, body, and priority level.', 'In the Target Departments field, use the multi-select dropdown to choose one or more departments.', 'Click Publish to send the announcement.', 'Employees only see announcements targeted at their department or company-wide announcements with no department filter.'], callout: { type: 'tip', text: 'Leave the department selector empty to send a company-wide announcement visible to all employees.' } },
      { title: 'Private Welcome Announcements', purpose: 'Automated welcome messages for new starters, created by a daily scheduled job and visible only to the individual employee.', steps: ['A daily cron job runs at 07:00 UTC and checks for employees whose start date is today.', 'For each new starter, a private welcome announcement is automatically created.', 'The welcome message is visible only to that employee on their personal dashboard.', 'The message directs the new starter to the User Guide and E-Learning modules to help them get started.', 'Welcome announcements are automatically deleted after 2 weeks.', 'An audit log of all generated welcome announcements is available on the Announcements page.'], callout: { type: 'note', text: 'Welcome announcements are fully automated — no admin action is required. They are private to the individual employee and do not appear in the company-wide announcements feed.' } },
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
    icon: '📝', title: 'Surveys & Feedback',
    features: [
      { title: 'Create a Survey', purpose: 'Build custom surveys to gather employee feedback on workplace topics.', steps: ['Navigate to Admin > Surveys from the sidebar.', 'The Templates tab shows available survey templates and your company\'s custom surveys.', 'Click + New Survey to create a custom survey with a title, description, and questions.', 'Add questions of different types: rating scale (1–5), multiple choice, or free text.', 'Mark questions as required or optional. Save the survey as a draft or publish immediately.'] },
      { title: 'Deploy a Survey', purpose: 'Send a survey to employees and set a response deadline.', steps: ['Switch to the Deployments tab.', 'Click + New Deployment, select a survey template or custom survey, and choose the target audience (all employees, specific departments, or individual employees).', 'Set the start and end dates for the deployment window.', 'Click Deploy. Targeted employees see the survey on their Surveys page and receive a notification.'], callout: { type: 'note', text: 'Each survey can only be deployed once to the same audience. Duplicate deployments to the same group are prevented automatically.' } },
      { title: 'Track Responses', purpose: 'Monitor response rates and view submitted answers.', steps: ['On the Deployments tab, each deployment shows the response count and completion percentage.', 'Click a deployment to view individual responses and aggregate results.', 'Rating questions show average scores; multiple choice shows response distribution; free text responses are listed in full.'] },
      { title: 'Survey Insights', purpose: 'View analytics dashboards summarising survey results across deployments.', steps: ['Click the Insights button on any deployment, or navigate to Admin > Surveys > Insights.', 'View charts showing response trends, average ratings by question, and department-level breakdowns.', 'Use insights to identify areas of concern and track sentiment over time.'], callout: { type: 'tip', text: 'Deploy the same survey periodically to track how employee sentiment changes over time.' } },
    ],
  },
  {
    icon: '📊', title: 'HR Reports',
    features: [
      { title: 'Run HR Reports', purpose: 'Generate data reports across all HR modules for analysis, compliance, and decision-making.', steps: ['Navigate to Admin > Reports from the sidebar.', 'Select a report from the list — available reports cover: Leave Requests, Expenses, Payroll Summary, Employee Directory, Timesheets, Shifts, Performance Reviews, E-Learning Progress, Onboarding Status, Benefits Enrolment, Skills Passport, Space Bookings, Kudos Activity, Legal Timesheets, Survey Responses, Workflow Tracker, Turnover, Check-In Data, Shift Assignments, and Expense Types.', 'Each report loads data scoped to your company with relevant columns and filters.', 'Results are paginated (25 per page) — use the Previous/Next controls to navigate.'] },
      { title: 'Export Report Data', purpose: 'Download any report as a CSV file for use in spreadsheets or external systems.', steps: ['After running a report, click Export CSV to download the current dataset.', 'The CSV includes all columns shown in the report table.', 'Exports are scoped to your company only — no cross-tenant data is included.'], callout: { type: 'tip', text: 'Run reports regularly to stay on top of compliance obligations (e.g. overdue performance reviews, expiring certifications, leave utilisation).' } },
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
    icon: '👤', title: 'Guest Access',
    features: [
      { title: 'Overview', purpose: 'Grant temporary admin portal access to external users such as accountants, auditors, or consultants — without giving them a full employee profile.', steps: ['Navigate to Admin > Access Management > Guest Access tab.', 'Two authentication methods are available (controlled by the super admin): Email + One-Time Passcode (OTP) and Microsoft SSO.', 'Guest users can view specific admin areas based on their assigned role but never have an HR profile.'] },
      { title: 'Create an OTP Guest', purpose: 'Create a guest who signs in with an email and one-time passcode.', steps: ['Enter the guest\'s email address.', 'Select a role (e.g. Accounting, Read Only View).', 'Choose permissions: Read Only or Full Access.', 'If both auth methods are enabled, select "Email + Passcode" from the Auth Method dropdown.', 'Click Create Guest. A one-time passcode is generated.', 'Share the passcode securely with the guest. It expires after 48 hours.', 'The guest signs in on the login page under the Guest Access tab using their email and the passcode.'] },
      { title: 'Create an SSO Guest', purpose: 'Create a guest who signs in with Microsoft SSO via your company\'s Entra ID tenant.', steps: ['Prerequisite: The guest must already exist as a B2B guest user in your company\'s Microsoft Entra ID tenant.', 'Enter the guest\'s email address (must match the Entra B2B guest email).', 'Select a role and permissions.', 'If both auth methods are enabled, select "Microsoft SSO" from the Auth Method dropdown.', 'Click Create Guest. No passcode is generated — the guest authenticates via Microsoft.', 'The guest signs in on the login page under the Guest Access tab and clicks "Sign in with Microsoft".', 'On first login, InflowHR matches the verified email to the guest record and binds their account.'], callout: { type: 'note', text: 'SSO guests are double-gated: they must exist in the company\'s Entra ID tenant AND be whitelisted in InflowHR Guest Access. The company\'s conditional access policies also apply.' } },
      { title: 'Super Admin: Enable/Disable Guest Auth Methods', purpose: 'Control which guest login methods are available platform-wide.', steps: ['Navigate to Admin > Subscriptions > Pricing tab.', 'Scroll to Guest Access Settings.', 'Toggle "Email + One-Time Passcode (OTP)" on or off (on by default).', 'Toggle "Microsoft SSO (Entra ID B2B)" on or off (off by default).', 'At least one method must remain enabled at all times.', 'Changes take effect immediately on the login page for all companies.'] },
    ],
  },
  {
    icon: '🔄', title: 'Approval Delegation',
    features: [
      { title: 'Overview', purpose: 'Allow managers and admins to temporarily delegate their approval responsibilities to a colleague for a set period — covering leave, expenses, and timesheet approvals.', steps: ['Navigate to Admin > Settings (or an individual manager can set this up from their HR app Settings > Approval Delegation).', 'The Approval Delegation section shows all active, upcoming, and past delegations for the company.', 'Admins can create delegations on behalf of any manager, or managers can create their own.'] },
      { title: 'Create a Delegation', purpose: 'Set up a temporary approval handover between two employees.', steps: ['Click + New Delegation.', 'Select the delegator (the person going away) and the delegate (the person covering).', 'Set start date and end date (UK format DD/MM/YYYY).', 'Choose the scope: All (leave + expenses + timesheets), or select individual types.', 'Optionally add a reason for the delegation.', 'Click Save. Both parties receive a notification.'], callout: { type: 'note', text: 'The delegate must be an active employee in the same company. They do not need admin access — they receive the delegator\'s pending approvals in their own Notifications > Actions tab.' } },
      { title: 'How It Works', purpose: 'During the delegation period, the system routes pending approvals to both the original approver and their delegate.', steps: ['When an employee submits a leave request, expense claim, or timesheet, the system checks if their manager has an active delegation.', 'If a delegation is active and today falls within the start/end date range, the delegate also sees the pending approval in their Actions tab.', 'Delegated approvals are labelled "On behalf of [Manager Name]" so the delegate knows they are covering.', 'Either the manager or the delegate can approve or reject — whichever acts first resolves the request.', 'The audit trail records who actioned the request (the delegate\'s name, with a note that it was delegated).'] },
      { title: 'Cancel or Expire', purpose: 'Delegations end automatically or can be cancelled early.', steps: ['Delegations expire automatically at the end of the end date — no action needed.', 'To cancel early, click Cancel on the active delegation row. The delegate is notified that their cover period has ended.', 'Past delegations remain visible in the history for audit purposes.'] },
    ],
  },
  {
    icon: '💬', title: 'Employee Help',
    features: [
      { title: 'Manage FAQ Articles', purpose: 'Create and organise the knowledge base that powers the employee help chat.', steps: ['Navigate to Admin > Employee Help from the sidebar.', 'The Company Articles tab shows articles specific to your company. The Global Articles tab shows platform-wide articles available to all companies.', 'Click + New Article to create a company-specific article with a category, question, answer, and keywords.', 'Set a data query type (e.g. Leave Balance, Next Shift) to make an article resolve personalised data for each employee.', 'Toggle articles active or inactive. Inactive articles are hidden from employees but not deleted.', 'Drag articles to reorder them within a category — the sort order controls which article appears first in search results.'] },
      { title: 'Search Metrics', purpose: 'Analyse how employees are using the help chat and identify knowledge gaps.', steps: ['Switch to the Search Metrics tab.', 'View summary cards: Total Searches, FAQ Matched (answered from articles), AI Answered (answered by the intelligent assistant), No Match, and Match Rate.', 'The Top Unanswered Questions section shows the most common queries that returned no results — use these to create new articles.', 'The Most Searched Articles section shows which articles are returned most frequently.', 'The Recent Searches table lists individual queries with their source (FAQ or AI badge), match status, and result count.', 'Filter by time period: last 7, 30, or 90 days.'], callout: { type: 'tip', text: 'Check the Top Unanswered Questions regularly and create new articles to cover common gaps. This reduces AI query costs and gives employees faster answers.' } },
      { title: 'AI Help Agent', purpose: 'Enable an intelligent assistant that answers employee questions when no FAQ article matches.', steps: ['The AI Help Agent is enabled from Admin > Integrations (not from this page).', 'When enabled, if an employee asks a question and no FAQ article matches, the system generates a helpful answer using your company\'s HR knowledge base.', 'The assistant only uses your company\'s own FAQ articles as its knowledge source — it never invents policies or references external information.', 'Employees see the same chat interface regardless of whether the answer came from a FAQ article or the intelligent assistant.', 'Each employee is limited to 20 AI-assisted queries per day.', 'AI query usage appears in the Search Metrics tab alongside FAQ metrics.'], callout: { type: 'note', text: 'Data Privacy: The AI Help Agent is fully GDPR-compliant. No employee personal data (names, leave balances, payslip details, NI numbers) is ever sent to any external service. Only the question text and generic HR article content are processed. Data-aware answers (e.g. "How many days leave do I have?") are always resolved locally from your company\'s secure database, not by the AI assistant.' } },
      { title: 'Handbook Management', purpose: 'Load your company\'s employee handbook so both AI assistants (AI Help Agent and Enterprise AI) can answer policy questions with your actual policies, figures, and section references instead of generic content.', steps: ['Navigate to Admin > Employee Help and switch to the Handbook tab.', 'If no handbook is loaded, the tab shows an empty state with options to paste or upload content.', 'Paste your handbook markdown into the text area, or click Upload File to load a .md or .txt file.', 'Enter a version number (e.g. "1.0" or "2025-04") to track which edition is loaded.', 'Click Load Handbook. The system splits the content on section headings (## ) and saves each section individually.', 'Once loaded, four status cards show: total sections, version, last updated date, and active status.', 'A table lists every section with its number, title, and content preview.', 'To update: paste or upload a new version in the Update Handbook area, enter the new version number, and click Replace All Sections. The old sections are removed and the new ones inserted.', 'To remove the handbook entirely, click Remove Handbook and confirm the deletion.'], callout: { type: 'tip', text: 'Both AI assistants search the handbook using full-text search. When an employee asks a policy question, the top 3 matching sections are included in the AI\'s context — so answers include your company\'s actual figures, notice periods, and section references. Keep section headings clear and descriptive for best results.' } },
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
      { title: 'AI Help Agent (Pack B)', purpose: 'Add intelligent AI-powered answers to the Employee Help chat when no FAQ article matches.', steps: ['Navigate to Admin > Integrations from the sidebar.', 'The AI Help Agent card requires a Pack B subscription. Without Pack B, the card shows "Pack B subscription required" and is disabled.', 'Toggle the AI Help Agent on to enable intelligent responses.', 'When enabled, if an employee asks a question and no FAQ article matches, the system automatically generates a helpful answer using your company\'s HR knowledge base.', 'The transition is seamless — employees see the same chat interface and cannot distinguish between FAQ and AI-generated responses.', 'Each employee is limited to 20 AI-assisted queries per day to manage costs.', 'View usage statistics (total AI queries and today\'s count) in the expanded card settings.'], callout: { type: 'note', text: 'The AI Help Agent only uses your company\'s own FAQ articles to generate answers — it never invents policies or shares data between companies. No employee personal data (names, leave balances, payslip details) is sent to any external service. Only the question text and generic FAQ article content are used. This feature is fully GDPR-compliant.' } },
      { title: 'First-Day Sign-In Passes (TAP)', purpose: 'Give new starters a one-time Temporary Access Pass so they can sign in and set up MFA on day one.', steps: [
        'Prerequisites:',
        'Your company must use InflowOnboarder (JML integration) with first-day passes enabled by your InflowOnboarder admin.',
        'The InflowOnboarder API key must include the "passes" scope.',
        'The Integrations page shows pass readiness: green "First-day passes available" when ready, amber when being set up, or grey when not enabled.',
        '',
        'Enabling a pass on a new starter schedule:',
        'When creating an onboarding schedule for a new starter, a checkbox appears: "Give {name} a first-day sign-in pass (collected once by {manager})."',
        'The checkbox is ticked by default when passes are available. Untick it to skip the pass for this starter.',
        'The pass is created automatically when the schedule\'s "Enable Sign-In" stage completes.',
        '',
        'Collecting the pass (manager):',
        'When the pass is ready, the new starter\'s line manager receives a notification in their My Notifications tab.',
        'Navigate to Admin > JML (Onboarding) and open the starter\'s record.',
        'The "First-day sign-in pass" card shows the pass status: Pending, Ready, Viewed, Expired, or Gone.',
        'Click "View pass (once)" — a confirmation dialog warns that the pass is shown once and then deleted.',
        'Click "Show It" to reveal the pass in a large monospace display. Note it down or hand it to the new starter immediately.',
        'The pass display includes: the pass value, the sign-in name (UPN), when it expires, and whether it works once or until expiry.',
        'After closing the modal, the pass is permanently deleted — it cannot be viewed again.',
        '',
        'New starter instructions:',
        'Go to https://aka.ms/mysecurityinfo, sign in with their work email, choose "Use a Temporary Access Pass", enter the pass, then set up the Microsoft Authenticator app.',
        '',
        'Requesting a new pass:',
        'If the pass expired or was already used, the card shows "This pass is no longer available" with a "Request a new pass" button.',
        'Clicking it creates a new pass — wait for it to be generated, then view it as above.',
      ], callout: { type: 'note', text: 'The pass value is never stored in InflowHR. Only metadata (who viewed it and when) is recorded. This ensures the pass remains secure even if the InflowHR database were compromised.' } },
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
    icon: '⚙️', title: 'Company Settings',
    features: [
      { title: 'Identity Provider', purpose: 'Configure which identity provider your company uses for employee authentication, and control which platform features are available based on your provider.', steps: ['Navigate to Admin > Settings from the sidebar.', 'Scroll to the Identity Provider section.', 'Choose between Microsoft Entra ID (the default) or Google Workspace as your company\'s identity provider.', 'When Google Workspace is selected, M365-specific features are automatically hidden from the admin portal and employee app. This includes InflowOnboarder (JML integration), licence assignment, and persona management.', 'If not all employees receive full licenced accounts, toggle on "Skip Licence Assignment" to bypass the licence assignment step in onboarding workflows.', 'Changes take effect immediately — the admin sidebar and onboarding workflow update on next page load.'], callout: { type: 'note', text: 'Switching identity provider does not affect existing employee records or data. It controls which authentication method is used at sign-in and which M365-dependent features are visible.' } },
    ],
  },
  {
    icon: '💳', title: 'Billing',
    features: [
      { title: 'View Subscription & Costs', purpose: 'See a breakdown of your company\'s InflowHR subscription and download invoices.', steps: ['Navigate to Admin > Billing from the sidebar.', 'The Core plan card shows your base subscription — this includes Leave, Performance, E-Learning, Expenses, Onboarding/Offboarding, Payroll (Xero/Sage), Kudos, Announcements & Notifications, Benefits, GDPR Document Storage, Timesheets, HR Tickets, and Email Notifications.', 'Add-on packs are listed separately: People Operations (Shifts & Rotas, Legal Timesheets, Space & Desk Booking, Asset Management), and Pro Integrations (Teams & Presence, Skills Passport & Talent Intelligence, Modulr Payments & BACS Export, AI Help Agent).', 'The pricing table lists each enabled feature module with its per-user monthly cost.', 'View your total employee count and calculated monthly total (net + 20% VAT).', 'Monthly invoice history is listed below — click any invoice to download the PDF.', 'Trial companies are indicated with a Trial badge next to the company name. All features are set to £0 during the trial period.'], callout: { type: 'note', text: 'Feature activation and pricing changes are managed by the InflowHR platform team. Contact your account manager to adjust your subscription or add Pack A or Pack B.' } },
      { title: 'Manage Your Subscription Packs', purpose: 'View active packs, cancel individual packs, and understand the 7-day grace period.', steps: ['The "Your Packs" section appears on the Billing page when you have active add-on packs.', 'Each pack card shows the pack name, activation date, per-user price, and total monthly cost.', 'An amber "Grace period" badge appears for the first 7 days after activation, showing how many days remain.', 'To cancel a pack, click the "Cancel Pack" button on the pack card.', 'Within the grace period: the pack is disabled immediately with no charge — any pro-rata charge already applied is reversed.', 'After the grace period: the pack remains active until the end of the current billing month. No further charges apply from the next month.', 'A red "Cancelling" badge shows when a pack is scheduled for end-of-month cancellation, along with the effective date.', 'Cancelling a pack is separate from cancelling your entire subscription — the Cancel Subscription button at the bottom of the page handles the full service.'], callout: { type: 'tip', text: 'If you are unsure about a pack, you can safely enable it and cancel within 7 days for zero charge. The grace period starts from the moment the pack is activated.' } },
      { title: 'Pro-Rata Billing', purpose: 'Understand how mid-month pack activations are charged.', steps: ['When a pack is enabled part-way through the month, the charge is pro-rated: (remaining days ÷ total days in month) × price per user × number of employees.', 'For example, enabling a £3/user pack on the 20th of a 31-day month with 10 employees: (12 ÷ 31) × £3 × 10 = £11.61.', 'Pro-rata adjustments appear as separate line items in the billing breakdown table under the "Adjustments" heading.', 'Grace period reversals also appear as adjustments — these are negative amounts that offset the original pro-rata charge.', 'Downloaded invoices include all adjustments as line items before the subtotal.', 'Pro-rata billing does not apply to fixed-price or trial subscriptions.'] },
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
    icon: '📊', title: 'Platform Dashboard',
    features: [
      { title: 'Super Admin Dashboard Overview', purpose: 'A platform-wide overview of all HR activity across every subscribed company, with trend charts showing how metrics change over time.', steps: ['Navigate to Admin > Dashboard while signed in as a Super Admin.', 'The dashboard loads data across ALL companies — it is not filtered by the company selector.', '15 metric cards display key platform stats at a glance: Total Employees, Active Onboarders, Notifications Sent, Kudos Given, Surveys Deployed, Survey Responses, Open 1:1 Meetings, Active Goals, Space Bookings, Leavers (Offboarding), Active Movers, Total Leave Requests, Open HR Tickets, Pending Expenses, and Total Announcements.', 'Six cards include mini sparkline charts showing the 6-month trend — hover or tap to see the direction of change at a glance.', 'Click any metric card to jump directly to the relevant admin page.'] },
      { title: 'Trend Charts', purpose: 'Six larger trend charts below the metric cards show how key metrics have changed over the last 6 months.', steps: ['Scroll below the metric cards to see the Trend Charts section.', 'Charts are displayed in a responsive grid — two or three per row depending on screen width.', 'Available charts: Employees (line), Onboarders (bar), Notifications (line), Kudos (bar), Bookings (bar), and Tickets (bar).', 'Each chart shows monthly data points with labelled axes, grid lines, and value annotations on each data point.', 'Use these trends to identify patterns — for example, a spike in HR tickets or a drop in kudos activity.'] },
      { title: 'Feature Subscriptions Chart', purpose: 'A bar chart showing how many companies have each feature module enabled.', steps: ['The Feature Subscriptions section shows a horizontal bar chart.', 'Features tracked: Leave, Expenses, Timesheets, Shifts & Rotas, Legal Timesheets, Kudos, Space Booking, Surveys, Asset Management, E-Learning, and Check-In.', 'Use this chart to understand feature adoption across your customer base and identify upsell opportunities.'] },
      { title: 'Archives Table', purpose: 'View and manage archived company data.', steps: ['Scroll to the bottom of the dashboard to see the Archives table.', 'Archived records show company name, financial year, archive date, and actions.', 'Use this to track which companies have had their data archived for compliance or housekeeping purposes.'] },
    ],
  },
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
      { title: 'Feature Activation per Company', purpose: 'Enable or disable feature modules for individual companies.', steps: ['Switch to the Features tab.', 'Select a company from the dropdown.', 'Toggle features on or off. Optionally set a custom price that overrides the global default.', 'Features are organised into packs: Core (included), People Operations (Shifts & Rotas, Legal Timesheets, Space & Desk Booking, Asset Management), and Pro Integrations (Teams & Presence, Skills Passport, Modulr Payments, and AI Help Agent).', 'The AI Help Agent feature requires Pack B to be enabled. Once Pack B is active, the company admin can toggle the AI Help Agent on or off from their Integrations page.', 'Changes take effect immediately — the company\'s sidebar and employee dashboard update on next page load.'], callout: { type: 'tip', text: 'Disabling a feature hides it from the company admin and all employees but does not delete any associated data.' } },
      { title: 'Enable & Disable Packs (Pro-Rata)', purpose: 'Add or remove pack bundles for a company with automatic pro-rata billing.', steps: ['On the Features tab, select the target company.', 'Click "Enable Pack" on the Pack A or Pack B card. This calls the server-side enable_pack RPC which:', '— Activates the pack and all its child features.', '— Calculates the pro-rata charge: (remaining days ÷ total days in month) × price per user × employee count.', '— Creates a billing_adjustments record for the current month.', '— Logs the change in the feature_change_log audit table.', 'Pro-rata charges are skipped automatically for fixed-price and trial companies.', 'To cancel a pack, click "Cancel Pack". Within 7 days of activation (grace period), the pack is disabled immediately with a full reversal of the pro-rata charge. After the grace period, cancellation is scheduled for the end of the billing month.'], callout: { type: 'note', text: 'Both super admins and company admins can cancel packs. The grace period is 7 calendar days from activation.' } },
      { title: 'Feature Change History', purpose: 'View an audit trail of all pack and feature changes for a company.', steps: ['On the Features tab, scroll below the pack cards to find the Feature Change History table.', 'Each row shows: Date, Feature, Action (enabled / disabled / grace_cancelled / scheduled_cancel / rollover_disabled), Price, Employees, and Notes.', 'This log is immutable — entries cannot be edited or deleted.', 'Use it to investigate billing queries, verify when a pack was activated or cancelled, and confirm grace period reversals.'] },
      { title: 'Monthly Billing Rollover', purpose: 'Understand the automated end-of-month billing processes.', steps: ['On the 1st of each month at 00:05, a scheduled job (pg_cron) runs automatically.', 'The job locks the previous month\'s billing snapshots — locked snapshots cannot be overwritten by page views.', 'Any packs with a scheduled cancellation effective date in the previous month are disabled, and the change is logged as "rollover_disabled".', 'This ensures that end-of-month cancellations are processed reliably without manual intervention.'] },
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
      { title: 'Switching Companies', purpose: 'View and manage any company\'s data from a single admin session.', steps: ['Use the company dropdown in the top bar to switch the active company.', 'Company-scoped admin pages — employees, leave, expenses, payroll, etc. — immediately reflect the selected company\'s data.', 'Some Super Admin pages (Subscriptions, Cancellations) load global data regardless of the selected company.', 'The company selector is visible only to Super Admins.'] },
      { title: 'Feature Visibility', purpose: 'Super Admins see all sidebar modules regardless of the selected company\'s feature settings.', steps: ['Even if a feature is disabled for the selected company, it appears in the sidebar so you can access its admin page (which will show empty state or configuration options).'] },
    ],
  },
  {
    icon: '🌱', title: 'Trial Registration',
    features: [
      { title: 'Review Trial Requests', purpose: 'Process trial signup requests from prospective customers who registered via the public Try for Free page.', steps: ['Navigate to Admin > Subscriptions and switch to the Trial Requests tab.', 'Pending requests are listed with the applicant\'s full name, work email, phone number, and submission date.', 'Each request shows its current status: Pending, Approved, or Rejected.'] },
      { title: 'Provision a Trial Company', purpose: 'Create a fully populated trial company with demo data and login credentials.', steps: ['On a pending trial request, enter a Company Name in the input field.', 'Click Create Trial Data.', 'The system creates a new company with 14 days of trial access, all features enabled at zero cost, and 10 demo employees with realistic HR data across all modules.', 'Admin credentials (the applicant\'s email + auto-generated password) and a test employee login are displayed.', 'Copy and share the credentials with the prospect — the password is shown only in this view.'], callout: { type: 'note', text: 'Trial companies expire after 14 days. All features are enabled at £0 during the trial. Integrations (email, Xero, Sage, Teams) appear in the menu but are not connected.' } },
      { title: 'Convert or Extend Trials', purpose: 'Transition a trial to a paid subscription or extend the trial period.', steps: ['To convert: navigate to Subscriptions > Features, select the trial company, and update feature prices from £0 to standard rates.', 'To extend: update the trial_end_date in the database — there is no UI toggle for this.', 'Expired trials block login with a "Trial Expired" message until converted or extended.'] },
    ],
  },
  {
    icon: '🚫', title: 'Cancellations',
    features: [
      { title: 'Manage Company Cancellations', purpose: 'Process cancellation requests and manage frozen companies.', steps: ['Navigate to Admin > Cancellations from the sidebar.', 'Pending cancellation requests are listed with the company name, reason, requested date, and current status.', 'Review each request and approve or decline the cancellation.', 'Approved cancellations freeze the company — all employees are immediately blocked from signing in.', 'Frozen companies are listed with their freeze date and can be reactivated if needed.'], callout: { type: 'note', text: 'Freezing a company does not delete any data. Reactivation restores full access for all employees.' } },
    ],
  },
  {
    icon: '🤝', title: 'MSP Partner Channel',
    features: [
      { title: 'Overview', purpose: 'The MSP (Managed Service Provider) partner channel allows IT service providers to manage multiple client companies from a single admin session with wholesale pricing.', steps: ['MSP partners are companies with the is_msp flag enabled by a super admin.', 'Each MSP partner gets a dedicated MSP Dashboard with company management, user access control, and audit logging.', 'MSP-managed companies have their billing handled by the MSP — the company admin billing page is replaced with a "Managed by [MSP Name]" panel.', 'InflowHR invoices the MSP at wholesale rates; the MSP invoices their own clients separately.'] },
      { title: 'Setting Up an MSP Partner', purpose: 'Step-by-step process to designate a company as an MSP and link managed companies.', steps: ['Step 1 — Enable the global MSP feature: set msp_feature_enabled = true in the platform_settings table.', 'Step 2 — Flag a company as MSP: go to Company Management, edit the company, and toggle "MSP Partner" on. Select the tier (Starter/Growth/Enterprise) and wholesale discount. This unlocks the MSP Dashboard in their admin sidebar.', 'Step 3 — Link managed companies: edit each client company and set the "Managed By MSP" dropdown to the MSP company. Then insert rows into msp_managed_companies with the MSP\'s msp_company_id and each client\'s managed_company_id.', 'Step 4 — Grant MSP user access: the MSP admin uses their MSP Dashboard > Users tab to grant access to team members, with optional JSONB permission restrictions per managed company.'], callout: { type: 'note', text: 'Steps 2–3 can be done from the Company Management page. Step 1 requires a platform_settings database update. The msp_managed_companies linking row is still created via database until a future UI update.' } },
      { title: 'MSP Tiers & Wholesale Pricing', purpose: 'Wholesale pricing is tiered based on the total number of managed employees across all MSP client companies.', steps: ['Starter tier (1–100 employees): 20% wholesale discount.', 'Growth tier (101–500 employees): 30% wholesale discount.', 'Enterprise tier (501+ employees): 40% wholesale discount.', 'Tiers are recalculated based on total active employees across all managed companies.', 'Use the "Recalculate Tiers" button in Admin > Billing > MSP Wholesale Billing section to update tiers.', 'Tier changes update the discount percentage immediately — the next billing cycle reflects the new rate.'] },
      { title: 'MSP Wholesale Billing (Super Admin)', purpose: 'View consolidated MSP billing data in the super admin billing page.', steps: ['Navigate to Admin > Billing as a super admin.', 'The MSP Wholesale Billing section appears below the standard billing summary cards.', 'A table lists each MSP partner with: partner name, tier badge (starter/growth/enterprise), discount percentage, managed company count, total employees, and monthly wholesale amount.', 'Click "Recalculate Tiers" to auto-update all MSP tiers based on current employee counts.', 'Each MSP row is expandable to show the individual managed companies and their costs.'] },
      { title: 'MSP Dashboard (MSP Admin)', purpose: 'The MSP admin view with company management, user access, and audit logging.', steps: ['The MSP Dashboard is visible in the sidebar only for users with MSP admin access.', 'Companies tab — lists all managed companies with status, employee count, and quick actions.', 'Users tab — grant or revoke access for MSP team members to specific managed companies. Set JSONB permissions to restrict sidebar visibility per user per company (e.g. hide Payroll, hide Billing).', 'Audit Log tab — shows all MSP actions: company switches, access grants, access revocations. Each entry shows date (DD/MM/YYYY), action type, target company, and details.'] },
      { title: 'MSP Permission Scoping', purpose: 'Granular per-user permissions control which admin sidebar items an MSP user can see when viewing a managed company.', steps: ['Permissions are stored as JSONB on the msp_user_access table, e.g. {"payroll": false, "billing": false}.', 'When an MSP user switches to a managed company, the system fetches their permissions via the get_msp_permissions RPC.', 'Sidebar items with a matching permKey set to false are hidden for that user on that company.', 'Omitting a key or setting it to true means the item is visible (default is full access).', 'Permissions are checked per-company — the same MSP user can have different access levels on different managed companies.'] },
      { title: 'MSP-Managed Company Billing', purpose: 'Company admins of MSP-managed companies see a simplified billing view.', steps: ['When a company has managed_by_msp_id set, the standard billing page is replaced with a centred panel showing "Billing Managed by [MSP Partner Name]".', 'The company admin cannot see pricing, invoices, or subscription details — the MSP handles all billing.', 'Super admins can still see the full billing page for MSP-managed companies.'] },
    ],
  },
  {
    icon: '💰', title: 'Payroll Operations Guide',
    features: [
      { title: 'Process Summary', purpose: 'End-to-end overview of running payroll each month. The process differs depending on whether the company is connected to Xero/Sage or running standalone.', steps: [
        'Connected mode (Xero/Sage): Select Workers → Review Adjustments → Push & Manual Actions → Processing → Sync Back → Release.',
        'Standalone mode (no provider): Select Workers → Review → Generate Estimates → Export → Sync & Release.',
        'Employee types: Salaried (employed), Shift Workers (contracted hours), and Zero Hours Workers each have separate payslip generation logic.',
        'After payslips are generated, push to Modulr for bank payments (if connected), then release payslips to employees.',
        'Key rule: always submit to Modulr BEFORE releasing payslips to employees. The Release All button is disabled until Modulr is done.',
      ], callout: { type: 'note', text: 'Pay runs are month-based. You can run multiple worker types in a single pay run or run them separately. The wizard remembers where you left off if you navigate away.' } },

      { title: 'Step 1 — Select Worker Types', purpose: 'Choose which employee categories to include in this pay run.', steps: [
        'Navigate to Admin > Payroll and click the New Pay Run tab.',
        'Select a pay month from the month/year selectors at the top.',
        'Tick one or more worker types: Employed (salaried staff), Shift Workers (contracted-hours staff), Zero Hours Workers.',
        'The wizard shows the employee count for each type. Only active employees with the matching employment_category are included.',
        'Employed = employment_category is not "shift_worker". Shift Workers = employment_category is "shift_worker" and contract_type is not "Zero hours shift worker". Zero Hours = contract_type is "Zero hours shift worker".',
        'Click Next to proceed to the review step.',
      ] },

      { title: 'Step 2 — Review Adjustments (Connected Mode)', purpose: 'Review each employee\'s calculated gross pay, deductions, overtime, sick pay adjustments and benefit deductions before pushing to the payroll provider.', steps: [
        'The review table is split into sub-tabs per worker type if you selected more than one.',
        'Salaried employees: base pay = annual_salary ÷ 12 (monthly) or ÷ 52 (weekly). Overtime is calculated as: base hourly rate × OT hours × OT multiplier. The OT multiplier defaults to ×1.5 but can be edited per employee inline.',
        'Shift workers: gross pay = approved timesheet hours × hourly_rate. Overtime hours from timesheets are added at the multiplied rate.',
        'Zero hours workers: gross pay = approved timesheet hours × hourly_rate. If the employee has guaranteed_hours_approved, excess hours above the guarantee are paid separately.',
        'Sick pay: the wizard checks leave_requests for sick leave in the period. SSP is calculated based on the employee\'s sick_pay_status (qualifying/waiting/exhausted) and daily rate.',
        'Benefits: any benefit_types with payroll_deduction_enabled are listed as deductions, with the deduction_amount and deduction_frequency applied.',
        'Review totals at the bottom: gross pay, tax (estimate), NI, net pay per employee and overall.',
        'Click Generate to create payslips or Push to push adjustments to Xero/Sage.',
      ] },

      { title: 'Salaried Employee Payroll', purpose: 'Detailed steps for running payroll for salaried (employed) staff.', steps: [
        'Salaried employees derive pay from the annual_salary field on their employee record. Monthly pay = annual_salary ÷ 12.',
        'Tax is estimated using HMRC bands: 20% (£12,571–£50,270), 40% (£50,271–£125,140), 45% (above £125,140). Tax code overrides are applied if set.',
        'NI is estimated using HMRC thresholds: 8% employee (above £12,570 p.a.), 13.8% employer (above £9,100 p.a.).',
        'Overtime: if the employee has approved overtime hours in their period review, OT pay = base hourly rate × hours × multiplier. The base hourly rate is derived as: hourly_rate field (if set), else annual_salary ÷ (52 × weekly_hours). The multiplier defaults to ×1.5 and can be edited in the wizard.',
        'Connected mode (Xero): overtime is pushed as a Pay Template earning line with ratePerUnit = base hourly rate and numberOfUnits = hours × multiplier. This means Xero shows the real rate and multiplied units.',
        'Bonus: if bonus_amount and bonus_frequency are set, the bonus is added to gross pay for the relevant periods.',
        'The wizard shows the net pay breakdown: gross − tax − NI − pension − benefit deductions = net pay.',
      ], callout: { type: 'tip', text: 'For Xero-connected companies, overtime Pay Template lines are PERMANENT — they repeat every pay run until deleted. Push OT before creating the pay run in Xero so the template auto-populates onto the run.' } },

      { title: 'Shift Worker Payroll', purpose: 'Detailed steps for running payroll for contracted-hours shift workers.', steps: [
        'Shift workers derive pay from approved timesheets. Navigate to Admin > Timesheets and ensure all timesheets for the pay period are approved before running payroll.',
        'The wizard pulls timesheets where status = "approved" for the selected month, grouped by employee.',
        'Gross pay = total_hours × hourly_rate (from the employee record). Overtime hours from the timesheet are added at hourly_rate × OT multiplier.',
        'If a shift worker has adjusted_hours on their timesheet (from shift corrections), the adjusted figure is used instead of total_hours.',
        'Tax and NI are calculated the same as salaried staff, but annualised from the period gross (gross × 12 for monthly, × 52 for weekly).',
        'Sick pay for shift workers uses the daily rate: hourly_rate × (weekly_hours ÷ contracted_days).',
        'For Xero/Sage connected: the wizard pushes the calculated gross as an earnings adjustment. For standalone: payslips are generated locally.',
      ] },

      { title: 'Zero Hours Worker Payroll', purpose: 'Detailed steps for running payroll for zero hours contract workers.', steps: [
        'Zero hours workers also derive pay from approved timesheets, identical to shift workers.',
        'If the company has zero hours compliance enabled (Admin > Shifts & Rotas > Compliance), the wizard checks for guaranteed hours transitions.',
        'Employees with guaranteed_hours_approved = true have a guaranteed_weekly_hours figure. Hours above this guarantee are paid as excess hours.',
        'The excess hours calculation: if total timesheet hours > guaranteed_weekly_hours × weeks_in_period, the excess is separated on the payslip.',
        'Shift cancellation compensation: if a zero hours worker had shifts cancelled with less than the required notice period, compensation is calculated per the compliance settings (cancellation_compensation_rate × hourly_rate × cancelled_hours).',
        'Pension auto-enrolment: the wizard checks if the worker\'s earnings trigger auto-enrolment thresholds and flags accordingly.',
        'All other calculations (tax, NI, benefits) follow the same logic as shift workers.',
      ], callout: { type: 'note', text: 'Zero hours compliance features (guaranteed hours, cancellation compensation) only apply when the zero_hours_compliance feature is enabled for the company.' } },

      { title: 'Step 3 — Push to Provider (Connected Mode)', purpose: 'Push payroll adjustments to Xero or Sage for final processing.', steps: [
        'After reviewing, click "Push to Xero" or "Push to Sage" depending on the connected provider.',
        'The edge function (xero-push-payroll or sage-payslips) sends adjustments to the provider\'s API.',
        'For Xero: overtime is pushed as Pay Template earnings. Benefit deductions are pushed if sync_benefits_to_xero is enabled on the integration.',
        'For Sage: adjustments are pushed as pay items on the employee\'s pay run.',
        'Wait for the push to complete — the wizard shows a progress indicator and result summary.',
        'If any employees fail (e.g. not found in Xero, missing earnings rate), they are listed with error details. You can fix the issue and re-push.',
        'After pushing, open Xero/Sage to create and approve the pay run. The pushed adjustments auto-populate onto the run.',
      ], callout: { type: 'tip', text: 'TOIL (time off in lieu) hours are excluded from the Xero/Sage push — they are tracked internally only.' } },

      { title: 'Step 4 — Sync Payslips Back', purpose: 'Pull the finalised payslips from Xero/Sage back into InflowHR after the pay run is approved in the provider.', steps: [
        'Once you have approved and posted the pay run in Xero/Sage, return to the InflowHR wizard.',
        'Click "Sync Payslips" to pull the completed payslips back from the provider.',
        'The sync fetches each employee\'s payslip for the period: gross, tax, NI, net, pension, and any other deductions.',
        'Payslips are stored in the payslips table with source = "xero" or "sage" and status = "paid".',
        'Review the synced payslips in the table — check that totals match what you approved in the provider.',
        'For standalone mode: this step is replaced by "Export" where you download a CSV/Excel of the generated payslips.',
      ] },

      { title: 'Step 5 — Modulr Payment', purpose: 'Push net pay amounts to Modulr for bank transfer processing.', steps: [
        'If the company has Modulr integration connected, the "Pay with Modulr" button appears on the payslips page.',
        'Click "Pay with Modulr" to push all eligible payslips. Eligible = status is "paid", not yet released, source is xero/sage, and not already pushed to Modulr.',
        'The system validates each employee\'s bank details: sort code must be 6 digits, account number must be 8 digits.',
        'Employees with missing or invalid bank details are SKIPPED — their names are listed in the result message.',
        'The system checks the modulr_payment_items table to prevent double submission — even across page refreshes.',
        'After submission, each payslip row shows a "Modulr ✓" badge. The batch ID is shown in the success message.',
        'Failed Modulr records (e.g. bank rejection) can be retried individually using the per-row "Pay with Modulr" button.',
      ], callout: { type: 'note', text: 'Double submission protection: the system checks the database for existing payment items before pushing. If all payslips have already been submitted, you get a clear "already submitted" message.' } },

      { title: 'Step 6 — Release Payslips', purpose: 'Make payslips visible to employees in their HR app.', steps: [
        'Release All: click to release all unreleased payslips for the month. This button is DISABLED if Modulr has unpushed payslips — you must submit to Modulr first.',
        'Individual release: click the release toggle on any payslip row. If that payslip hasn\'t been pushed to Modulr, a confirmation dialog asks "Release anyway?".',
        'Released payslips appear on the employee\'s Payslips page immediately.',
        'You can un-release a payslip by clicking the toggle again — it will disappear from the employee\'s view.',
        'For Modulr-connected companies: the recommended flow is Push to Modulr → verify payments → Release All.',
        'For non-Modulr companies: Release All is available immediately after payslips are synced/generated.',
      ] },

      { title: 'Deleting a Pay Run', purpose: 'Remove an entire month\'s payslips if something went wrong.', steps: [
        'On the Payslips tab, click the delete icon next to the month group header.',
        'Confirm the deletion in the dialog. This deletes all payslips for that month and worker type.',
        'The deletion also removes the corresponding payroll_run record.',
        'Deletion is permanent — you will need to re-run the wizard to regenerate payslips.',
        'If payslips were already released, employees lose access to them immediately upon deletion.',
        'If Modulr payments were already submitted, the bank transfers are NOT reversed — contact Modulr directly for reversals.',
      ], callout: { type: 'note', text: 'Payslip deletions are logged in the payroll audit log (Admin > Payroll > Logs tab) with the deleting user and timestamp.' } },

      { title: 'Troubleshooting Common Issues', purpose: 'Quick reference for common payroll problems and their fixes.', steps: [
        'Overtime shows £0 in Xero: check the employee has an hourly_rate or annual_salary set. If annual_salary is used, the hourly rate is derived as salary ÷ (52 × weekly_hours).',
        'Payslip totals don\'t match Xero: re-sync payslips from Xero. The InflowHR wizard generates estimates; Xero calculates the exact tax/NI.',
        'Employee missing from pay run: check they are active, have the correct employment_category, and are assigned to the company.',
        'Shift worker shows £0: check their timesheets are approved for the pay period. Only approved timesheets feed into payroll.',
        'Modulr payment fails: check the employee\'s bank details (6-digit sort code, 8-digit account number). Update in Admin > Employees > Pay tab.',
        'Release All does nothing: if Modulr is connected, you must submit to Modulr first. The button is disabled with a "Submit to Modulr first" tooltip.',
        'Can\'t release one employee individually: click the release toggle — a confirm dialog appears for non-Modulr payslips.',
      ] },
    ],
  },
  {
    icon: '🛡️', title: 'Support Access',
    features: [
      { title: 'Grant Support Access', purpose: 'Temporarily grant the InflowHR support team read access to a company\'s data for troubleshooting.', steps: ['Navigate to Admin > Support Access from the sidebar.', 'Select a company and scope of access (restricted data or configuration only).', 'Set an expiry period and provide a reason for the access grant.', 'The grant is logged with an audit trail showing who granted it, when, and why.'] },
      { title: 'Manage Active Grants', purpose: 'View, extend, or revoke existing support access grants.', steps: ['The Support Access page lists all active and expired grants with company, scope, expiry date, and status.', 'Click Revoke to immediately terminate an active grant.', 'Expired grants are kept in the list for audit purposes.'], callout: { type: 'tip', text: 'All support access is time-limited and audited. Grants cannot be self-assigned — a super admin must create them.' } },
    ],
  },
  {
    icon: '📖', title: 'Employee Handbook Loading',
    features: [
      { title: 'Overview', purpose: 'Load a company\'s employee handbook into InflowHR so both AI assistants (AI Help Agent and Enterprise AI) answer employee questions using the company\'s actual policies, figures, and section references.', steps: ['Each company\'s handbook is stored in the handbook_sections table, scoped by company_id with row-level security.', 'Both AI assistants search handbook sections using full-text search — the top 3 matching sections are included in the AI\'s prompt alongside FAQ articles.', 'Handbooks can be loaded in two ways: via the admin UI (Handbook tab on Employee Help) or via SQL in the Supabase SQL Editor.', 'The SQL method is recommended for initial bulk loading; the admin UI is ideal for company admins managing their own content.'] },
      { title: 'Method 1: Build from Questionnaire (Recommended)', purpose: 'Use the handbook build tool to generate a client handbook and Supabase SQL from the master template and a filled questionnaire.', steps: ['Locate the handbook kit in the Intunehrflow/handbook folder. It contains the master template, questionnaire, and build script.', 'Copy client-questionnaire.xlsx and name it after the client (e.g. acme-ltd.xlsx).', 'Work through the questionnaire with the client. Fill in the yellow "Client answer" column. Orange rows must be answered; leave others blank to use suggested wording.', 'Run the build script: python3 build_handbook.py acme-ltd.xlsx clients/acme-ltd --supabase-sql', 'Add --draft if not all answers are in yet — gaps show as [TO CONFIRM: ...] and are listed in to-confirm.txt.', 'The script produces: handbook.docx (for the client), handbook.md (plain text), knowledge-base/ (section files), ai-assistant-instructions.md, and supabase-handbook.sql.', 'Find the company UUID: SELECT id, name FROM companies WHERE name ILIKE \'%client name%\';', 'Open supabase-handbook.sql and replace every COMPANY_ID_HERE with the UUID.', 'Run the SQL in the Supabase SQL Editor. Sections are loaded immediately — both AI assistants start using them.'], callout: { type: 'tip', text: 'To update a client\'s handbook, re-run build_handbook.py with --supabase-sql, replace the UUID, and run the SQL again. The script deletes old sections first, so there are no duplicates. Increase the version number in the questionnaire when reissuing.' } },
      { title: 'Method 2: Admin UI (Handbook Tab)', purpose: 'Company admins can load handbook content directly from the Employee Help page without needing SQL access.', steps: ['Navigate to Admin > Employee Help and switch to the Handbook tab.', 'Paste the handbook markdown into the text area, or click Upload File to load a .md or .txt file.', 'Enter a version number and click Load Handbook.', 'The system splits the content on ## headings and saves each section to the handbook_sections table.', 'To update, paste or upload new content in the Update Handbook area and click Replace All Sections.', 'To remove, click Remove Handbook and confirm.'] },
      { title: 'Prerequisites', purpose: 'Ensure the platform is ready before loading handbooks for a company.', steps: ['Migration 243_handbook_sections.sql must be applied — this creates the handbook_sections table with full-text search indexes and RLS policies.', 'The ai-help-agent and enterprise-ai-agent edge functions must be deployed with handbook search support (included since the handbook feature was added).', 'The company must have the AI Help Agent feature enabled (Pack B) for the standard assistant, or Enterprise AI configured with BYOK Azure credentials for the enterprise assistant.', 'The handbook content should be in markdown format with ## section headings for correct parsing.'], callout: { type: 'note', text: 'Every April: update statutory rates in master-template.md (sick pay, family pay, minimum wage, redundancy cap, Appendix A), then rebuild every client handbook from their saved questionnaire. The Employment Rights Act 2025 sections marked "Coming in" need updating as each change takes effect.' } },
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
  const [search, setSearch] = useState('')

  const filterSections = (sections: GuideSection[]): GuideSection[] => {
    if (!search.trim()) return sections
    const q = search.toLowerCase()
    return sections.map(section => {
      const matchedFeatures = section.features.filter(f =>
        f.title.toLowerCase().includes(q) ||
        f.purpose.toLowerCase().includes(q) ||
        f.steps.some(s => s.toLowerCase().includes(q)) ||
        (f.callout && f.callout.text.toLowerCase().includes(q))
      )
      if (matchedFeatures.length > 0 || section.title.toLowerCase().includes(q)) {
        return { ...section, features: matchedFeatures.length > 0 ? matchedFeatures : section.features }
      }
      return null
    }).filter(Boolean) as GuideSection[]
  }

  const filteredEmp = useMemo(() => filterSections(EMPLOYEE_SECTIONS), [search])
  const filteredAdm = useMemo(() => filterSections(ADMIN_SECTIONS), [search])
  const filteredSup = useMemo(() => filterSections(SUPER_SECTIONS), [search])

  const autoOpen = useMemo(() => {
    if (!search.trim()) return {}
    const sections = tab === 'employee' ? filteredEmp : tab === 'admin' ? filteredAdm : filteredSup
    const map: Record<number, boolean> = {}
    sections.forEach((_, i) => { map[i] = true })
    return map
  }, [search, tab, filteredEmp, filteredAdm, filteredSup])

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
      text: 'Access the Admin Portal from Settings > Go to Admin Portal, or navigate to /admin directly. The sidebar organises modules into collapsible groups (People, Time & Attendance, Pay & Finance, Engagement, Workspace, and Settings) — click a group heading to expand or collapse it.',
      bullets: ['Dashboard — at-a-glance stats: total employees, pending leave, open expenses, tickets, and more.', 'Sidebar — modules are grouped into collapsible sections and only shown if the feature is active for your company.', 'Company Selector — Super Admins see a company dropdown in the top bar. Company-scoped admin pages reflect the selected company\'s data, settings, and integrations.', 'Employee Help — manage FAQ articles and load your company\'s employee handbook so AI assistants answer with your actual policies.'],
      callout: { type: 'tip', text: 'Use the Exit button in the top bar to return to the employee view at any time.' },
    },
    super: {
      title: 'Getting Started',
      text: 'As Super Admin you have full access to every company admin feature plus platform-level controls. Key differences from a standard Company Admin:',
      bullets: ['Platform Dashboard — 15 metric cards with sparkline trends, 6-month trend charts, and feature adoption across all companies.', 'Company selector — a dropdown in the top bar lets you switch between all registered companies.', 'Subscriptions — manage pricing, feature activation, trial requests, and company setup (sidebar item visible only to you).', 'Cancellations — review and process company cancellation requests, manage frozen companies.', 'E-Learning Course Management — full CRUD for courses and per-company visibility controls.', 'Employee Handbook Loading — build and load company handbooks so AI assistants answer with actual policies and figures.'],
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

      <div style={{ position: 'relative', marginBottom: 12 }}>
        <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input
          type="text"
          placeholder="Search guides..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid var(--admin-border, #e2e8f0)', fontSize: 14, background: 'var(--admin-input-bg, #fff)', color: 'inherit', boxSizing: 'border-box' }}
        />
        {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, opacity: 0.5, color: 'inherit' }}>&times;</button>}
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'employee' ? 'admin-tab-active' : ''}`} onClick={() => setTab('employee')}>Employee{search && filteredEmp.length > 0 ? ` (${filteredEmp.length})` : ''}</button>
        <button className={`admin-tab ${tab === 'admin' ? 'admin-tab-active' : ''}`} onClick={() => setTab('admin')}>Company Admin{search && filteredAdm.length > 0 ? ` (${filteredAdm.length})` : ''}</button>
        {isSuperAdmin && (
          <button className={`admin-tab ${tab === 'super' ? 'admin-tab-active' : ''}`} onClick={() => setTab('super')}>Super Admin{search && filteredSup.length > 0 ? ` (${filteredSup.length})` : ''}</button>
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

      {tab === 'employee' && <SectionAccordion sections={filteredEmp} openMap={search ? autoOpen : empOpen} onToggle={search ? () => {} : toggle(setEmpOpen)} />}
      {tab === 'admin' && <SectionAccordion sections={filteredAdm} openMap={search ? autoOpen : admOpen} onToggle={search ? () => {} : toggle(setAdmOpen)} />}
      {tab === 'super' && <SectionAccordion sections={filteredSup} openMap={search ? autoOpen : supOpen} onToggle={search ? () => {} : toggle(setSupOpen)} />}
      {search && (tab === 'employee' ? filteredEmp : tab === 'admin' ? filteredAdm : filteredSup).length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>No matching guides found for "{search}"</div>
      )}
    </div>
  )
}
