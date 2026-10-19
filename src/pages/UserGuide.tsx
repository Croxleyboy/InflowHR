import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

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

const SECTIONS: GuideSection[] = [
  {
    icon: '🏖️', title: 'Leave Management',
    features: [
      { title: 'View Leave Balances', purpose: 'See remaining allowance for each leave type at a glance.', steps: ['Open Time Off from the bottom bar.', 'Balances are shown as cards at the top — total allowance, used, and remaining.'] },
      { title: 'Request Leave', purpose: 'Submit a new leave request for manager approval.', steps: ['Tap + Request Leave on the Time Off page.', 'Select the leave type, start and end dates, and add an optional note.', 'Tap Submit. Your manager receives a notification to approve or decline. If your company has Teams Integration enabled, your manager also receives a Microsoft Teams message.'], callout: { type: 'note', text: 'Requests that exceed your remaining allowance will be flagged. Check your balance before submitting.' } },
      { title: 'Leave Calendar', purpose: 'See who in your team is off and when.', steps: ['From the Time Off page, tap Calendar.', 'Approved leave for your department is displayed on a shared calendar view.'] },
      { title: 'Leave History', purpose: 'Review all past and pending requests.', steps: ['From the Time Off page, tap History.', 'Filter by status (pending, approved, rejected) to find specific requests.'] },
      { title: '"I\'m Off" Quick Notification', purpose: 'Instantly notify your team you are away today.', steps: ['Tap the I\'m Off button on the Time Off page.', 'A notification is sent to your manager and team immediately.'] },
      { title: 'Shift Conflict Blocking', purpose: 'Leave requests are blocked when you have assigned shifts on the requested dates.', steps: ['When requesting leave, the system checks your published rota for shift conflicts on the requested dates.', 'If a conflict is found, a warning banner lists the affected shifts with dates and times.', 'You cannot submit the request until the conflicts are resolved — swap or remove the affected shifts first.', 'If you are already checked in and working today, you also cannot submit leave for today.'], callout: { type: 'note', text: 'This applies to all worker types: employed, shift workers, and zero hours staff.' } },
      { title: 'Zero Hours Holiday Pay', purpose: 'How holiday pay works if you are a zero hours worker.', steps: [
        'Your company uses one of two holiday pay methods for zero hours workers:',
        '',
        'Rolled-Up Holiday Pay:',
        '• Your holiday pay is included as a percentage uplift on each payslip (typically 12.07%).',
        '• Your Time Off page shows an information card explaining this.',
        '• You can still book annual leave for record-keeping — this tracks who is off and when, but no balance is deducted.',
        '• Check your payslips for the "Holiday Pay Uplift" line item.',
        '',
        'Accrual (Paid Leave):',
        '• You accrue holiday hours based on hours worked each pay period.',
        '• Your Time Off page shows your accrued balance in hours.',
        '• When booking annual leave, enter the number of hours you want to take off.',
        '• Your balance updates after each pay run.',
      ], callout: { type: 'tip', text: 'The 12.07% rate is the UK statutory minimum. Your company may offer a higher rate for enhanced contractual holiday.' } },
      { title: 'Predictable Hours', purpose: 'After a qualifying period of service (typically 12 weeks), you may be eligible to request guaranteed weekly hours.', steps: [
        'Your employer monitors your service length and average weekly hours automatically.',
        'If you qualify, your employer may send you a formal offer of guaranteed weekly hours.',
        'You can accept or decline the offer. Accepting transitions you to guaranteed hours with pro-rated annual leave.',
        'After accepting, hours above your guaranteed weekly amount continue to attract the zero hours holiday pay uplift.',
      ], callout: { type: 'note', text: 'This is part of UK zero hours worker protections. Your employer is required to monitor eligibility and offer predictable hours where applicable.' } },
      { title: 'Shift Cancellation Compensation', purpose: 'If your employer cancels a shift within the notice window, you are entitled to compensation.', steps: [
        'Your company sets a cancellation notice window (between 48 hours and 7 days before the shift).',
        'If a shift is cancelled within this window, compensation is calculated as: shift hours × your hourly rate.',
        'The compensation is automatically included in your next payslip as a "Shift Cancellation Compensation" line item.',
        'You can see the cancellation log in the Zero Hours Compliance tab (admin view) for full details.',
      ] },
      { title: 'Sickness Absence', purpose: 'How to report sick leave and understand your sick pay entitlement.', steps: [
        'Report your absence to your manager as early as possible on the first day of sickness.',
        'Your manager will submit a Sick Leave request on your behalf, or you can submit one from Time Off > + Request Leave > Sick Leave.',
        'Sick leave is not capped — there is no fixed limit on sick days. However, your pay transitions through phases:',
        '',
        'Company Sick Pay (CSP):',
        '• Full pay for a configurable number of days (e.g. 10 days), then half pay for a further period.',
        '• Your company sets the specific CSP entitlement.',
        '',
        'Statutory Sick Pay (SSP):',
        '• If your sickness continues beyond your CSP entitlement, your employer may move you to SSP.',
        '• SSP is currently £123.25 per week, payable for up to 28 weeks.',
        '• To qualify for SSP, you must earn at least the Lower Earnings Limit (currently £123 per week).',
        '',
        'Self-Certification & Fit Notes:',
        '• For absences up to 7 calendar days, you self-certify — no doctor\'s note is needed.',
        '• For absences over 7 calendar days, you must provide a fit note (Statement of Fitness for Work) from your GP.',
        '• Your employer tracks fit note requirements and will notify you if one is needed.',
        '',
        'Return to Work:',
        '• When you return, your manager may conduct a return-to-work meeting to support your transition back.',
        '• This is standard practice and helps identify any adjustments needed.',
      ], callout: { type: 'note', text: 'Under the Equality Act 2010, disability-related absence is considered separately from general sickness absence monitoring. If you have a disability or long-term health condition, speak to your HR team about reasonable adjustments.' } },
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
      { title: 'Home Dashboard', purpose: 'Your personalised landing page showing quick-access cards for all enabled features.', steps: ['The Dashboard is the first page you see after signing in.', 'Feature cards provide one-tap access to Leave, Expenses, Payslips, Timesheets, Shifts, E-Learning, Kudos, Performance, Benefits, Space Booking, Skills Passport, and more.', 'Stat summaries on each card show key numbers at a glance (e.g. leave remaining, pending expenses).', 'A birthday card shows upcoming birthdays for colleagues on your watchlist within the next 30 days.'] },
      { title: 'Detailed Dashboard', purpose: 'An expanded view with richer data across all your HR features.', steps: ['Tap the Detailed Dashboard link on the home page.', 'View breakdowns for leave usage, expense trends, timesheet hours, shift patterns, and more.', 'The birthday section shows watchlisted colleagues with birthdays in the next 30 days.'], callout: { type: 'tip', text: 'Add colleagues to your watchlist from the Directory page to see their upcoming birthdays on your dashboard.' } },
    ],
  },
  {
    icon: '👤', title: 'Profile & Directory',
    features: [
      { title: 'My Profile', purpose: 'View and update your personal details.', steps: ['Navigate to Home > My Profile.', 'View your job title, department, contract type, contact details, and emergency contacts.', 'Upload or change your avatar photo.'] },
      { title: 'Company Directory', purpose: 'Find colleagues by name, department, or job title.', steps: ['Tap Directory in the bottom navigation.', 'Search or scroll to find a colleague. Tap to view their profile card with contact details.'] },
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
      { title: 'Ask a Question', purpose: 'Get instant answers to common HR questions using the help chat.', steps: ['Tap the help chat icon (bottom-right of the screen) to open the assistant.', 'Type your question in plain English (up to 500 characters) — for example, "How many days leave do I have?" or "How do I submit an expense?".', 'The assistant searches your company\'s knowledge base and returns the most relevant answer.', 'If an exact FAQ article is found, the answer appears instantly. If not, an intelligent assistant generates a helpful response based on your company\'s HR policies.', 'Tap any article card to expand the full answer. For data-aware questions (leave balance, next shift, last payslip), your personal data is resolved in real time.'], callout: { type: 'tip', text: 'The assistant only uses your company\'s own HR articles and policies to answer questions — it never invents answers or makes up policies.' } },
      { title: 'Quick Topics', purpose: 'Browse common topics when you\'re not sure what to ask.', steps: ['If the assistant cannot find a match, it shows quick-topic chips for common categories (Leave, Pay, Shifts, Benefits, etc.).', 'Tap a chip to see all articles in that category.'] },
      { title: 'Data Privacy', purpose: 'Your personal data stays private and secure.', steps: ['When the assistant answers a data-aware question (e.g. your leave balance), it reads your data directly from your company\'s secure database — no personal information is shared with any external service.', 'Only the question text and general HR article content are used to find an answer. Your name, leave balance, payslip details, and other personal data are never sent outside the platform.', 'All queries are logged for analytics, but only the question text is stored — not the answer content or any personal data.'], callout: { type: 'note', text: 'The Employee Help assistant is fully GDPR-compliant. No employee personal data leaves the InflowHR platform.' } },
    ],
  },
  {
    icon: '🚪', title: 'Leaving & Offboarding (Admin)',
    features: [
      { title: 'Overview', purpose: 'When an employee leaves, the M365 offboarding workflow automates the removal of their Microsoft 365 account — blocking sign-in, removing groups, and revoking licences.', steps: [
        'This feature requires an active InflowOnboarder integration with the "Offboard leavers (workflow)" API key permission.',
        'Configure your offboarding approver under Admin > Integrations > InflowOnboarder > Offboarding Settings.',
      ], callout: { type: 'note', text: 'The offboarding workflow is only available to companies with an InflowOnboarder subscription.' } },
      { title: 'Configure the Offboarding Approver', purpose: 'Choose who approves each offboarding request before the M365 account is deprovisioned.', steps: [
        'Go to Admin > Integrations > InflowOnboarder and scroll to Offboarding Settings.',
        'Choose an approver mode:',
        '• Same as joiner — uses the same approver configured for new starter onboarding.',
        '• Nominated person — enter a specific approver name and email.',
        '• Line manager — the leaver\'s manager approves (falls back to nominated if no manager is set).',
        'Save your settings.',
      ] },
      { title: 'Start an Offboarding Workflow', purpose: 'Initiate the automated M365 offboarding for a leaver.', steps: [
        'Go to Admin > Onboarding > Offboarding tab and open the leaver\'s record.',
        'In the M365 Offboarding panel, click Start M365 Offboarding.',
        'The system checks the employee\'s M365 account status. This typically takes a few seconds.',
        'If the account is protected (e.g. litigation hold), a warning is shown — resolve externally, then click Re-check.',
        'Once the account check passes, the status moves to Ready for Approval.',
      ] },
      { title: 'Approval & Proceed', purpose: 'Send the offboarding for approval and then proceed once approved.', steps: [
        'Click Send for Approval. The configured approver receives a notification and email.',
        'The approver opens their Notifications > Actions tab and approves or declines.',
        'Once approved, the panel shows Approved — click Proceed with Offboarding.',
        'The system submits the approval to the InflowOnboarder engine and begins deprovisioning.',
        'The panel auto-refreshes while the engine processes — no manual action needed.',
      ] },
      { title: 'Workflow Statuses', purpose: 'Understand what each status means during the offboarding process.', steps: [
        'Checking Account — the engine is verifying the M365 account.',
        'Account Blocked — the account is protected and cannot be offboarded automatically.',
        'Ready for Approval — account check passed, waiting for you to send for approval.',
        'Awaiting Approval — approval submitted, engine is processing asynchronously.',
        'Deprovisioning — the engine is blocking sign-in, removing groups, and revoking licences.',
        'Completed — all actions finished. Device recovery details are shown.',
        'Failed — something went wrong. Use Re-check or Mark Complete Manually.',
      ] },
      { title: 'Manual Completion', purpose: 'Mark an offboarding as complete when the automated workflow cannot finish.', steps: [
        'If the workflow fails or the account was handled outside the automated process, click Mark Complete Manually.',
        'This updates the record to Completed without calling the InflowOnboarder engine.',
      ], callout: { type: 'tip', text: 'Manual completion is always available as a fallback — the offboarding record is never stuck.' } },
    ],
  },
  {
    icon: '📅', title: 'M365 Scheduling (Admin)',
    features: [
      { title: 'Overview', purpose: 'Schedule M365 account provisioning and deprovisioning ahead of time, so accounts are created or removed automatically on the right dates.', steps: [
        'This feature requires an M365 Scheduling subscription add-on AND an InflowOnboarder API key with scheduling permissions (hr.joiner / hr.leaver scopes).',
        'When both are active, a "Run Now / Schedule" toggle appears on the accounts step (joiners) and remove accounts step (leavers).',
      ], callout: { type: 'note', text: 'If you don\'t see the Schedule option, check Admin > Integrations for a hint about missing API key permissions.' } },
      { title: 'Schedule a Joiner', purpose: 'Create the new starter\'s M365 account ahead of their start date.', steps: [
        'Open the joiner\'s record in Admin > Onboarding and go to the accounts step.',
        'Switch the mode toggle to Schedule.',
        'Fill in the UPN, display name, and country — the same fields as "Run Now".',
        'Set "Prepare days before" (1–14, default 3). This controls how many days before the start date the account is created with sign-in disabled.',
        'Review the plan preview showing two stages:',
        '• Prepare account — creates the account N days before the start date at 09:00.',
        '• Enable sign-in — switches sign-in on at 08:00 on the start date.',
        'Click Send Schedule for Approval. The configured approver receives a notification.',
      ] },
      { title: 'Schedule a Leaver', purpose: 'Automate M365 account removal around the leave date.', steps: [
        'Open the leaver\'s record in Admin > Onboarding > Offboarding tab and go to the remove accounts step.',
        'Switch the mode toggle to Schedule.',
        'Set "Licence removal delay" (0–90 days, default 30). This controls how long after the leave date licences and groups are removed.',
        'Review the plan preview showing two stages:',
        '• Block access — blocks sign-in at 17:00 on the leave date.',
        '• Remove access — removes groups and licences N days after the leave date at 17:00.',
        'Click Send Schedule for Approval.',
      ] },
      { title: 'Approval Flow', purpose: 'Schedules must be approved before they are submitted to the engine.', steps: [
        'The approver receives a notification in their Actions tab with the full schedule plan.',
        'They can approve or decline. On approval, the admin sees an "Approved" badge and a Create Schedule button.',
        'Clicking Create Schedule submits the plan to the InflowOnboarder engine, which confirms the stages and times.',
        'Once created, the schedule runs automatically — no further action is needed unless something goes wrong.',
      ] },
      { title: 'Schedule Statuses', purpose: 'Understand what each status means during the schedule lifecycle.', steps: [
        'Pending Approval — waiting for the approver to approve or decline.',
        'Scheduled — the engine has accepted the schedule and will execute on the planned dates.',
        'Running — a stage is currently being executed by the engine.',
        'Blocked — something is preventing the next stage (e.g. no available licence). Use Check Again after resolving.',
        'Completed — all stages finished successfully.',
        'Cancelled — an admin cancelled the schedule before it completed.',
        'Failed — the engine encountered an error. Check the message and use Check Again or cancel.',
        'Missed — a stage\'s planned time has passed without executing. Use Check Again to retry.',
      ] },
      { title: 'Managing Active Schedules', purpose: 'Monitor, refresh, or cancel schedules after they are created.', steps: [
        'The schedule tracking panel shows a timeline with each stage, its planned date/time, and current status.',
        'Refresh — re-fetches the latest status from the engine.',
        'Check Again — retries a blocked or failed stage after you\'ve resolved the issue externally.',
        'Cancel — cancels the schedule with a reason. Any resources already provisioned (e.g. licences) are released.',
      ], callout: { type: 'tip', text: 'If a joiner\'s start date or leaver\'s end date changes, update the date on the record first, then cancel and re-create the schedule with the new dates.' } },
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

export default function UserGuide() {
  const navigate = useNavigate()
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({})

  useEffect(() => { window.scrollTo(0, 0) }, [])

  function toggleSection(idx: number) {
    setOpenSections(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  return (
    <div className="feature-page user-guide-page">
      <header className="user-guide-header">
        <button className="user-guide-back" onClick={() => navigate('/settings')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div>
          <h1>User Guide</h1>
          <p className="user-guide-subtitle">How to use InflowHR</p>
        </div>
      </header>

      <div className="user-guide-intro">
        <h3>Getting Started</h3>
        <p>Sign in with your company Microsoft or Google account, or with the account credentials provided by your administrator. Your dashboard shows quick-access cards for every feature your company has enabled. Use the bottom navigation bar to jump between pages:</p>
        <ul>
          <li><strong>Home</strong> — your personalised dashboard</li>
          <li><strong>Time Off</strong> — leave balances and requests</li>
          <li><strong>Directory</strong> — search colleagues</li>
          <li><strong>Notifications</strong> — announcements, actions and reminders</li>
          <li><strong>Settings</strong> — language, theme and feature visibility</li>
        </ul>
        <div className="user-guide-callout user-guide-callout-tip">
          <span>💡</span>
          <span><strong>Tip:</strong> InflowHR is a progressive web app. On mobile, use your browser's "Add to Home Screen" option for a native app experience.</span>
        </div>
      </div>

      {SECTIONS.map((section, si) => (
        <div key={si} className={`user-guide-section ${openSections[si] ? 'user-guide-section-open' : ''}`}>
          <button className="user-guide-section-toggle" onClick={() => toggleSection(si)}>
            <span className="user-guide-section-icon">{section.icon}</span>
            <span className="user-guide-section-title">{section.title}</span>
            <svg className="user-guide-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          {openSections[si] && (
            <div className="user-guide-section-body">
              {section.features.map((feat, fi) => (
                <div key={fi} className="user-guide-feature">
                  <h4>{feat.title}</h4>
                  <p className="user-guide-purpose">{feat.purpose}</p>
                  <ul>
                    {feat.steps.map((step, sti) => (
                      <li key={sti}>{step}</li>
                    ))}
                  </ul>
                  {feat.callout && (
                    <div className={`user-guide-callout user-guide-callout-${feat.callout.type}`}>
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
    </div>
  )
}
