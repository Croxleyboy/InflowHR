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
    icon: '🔗', title: 'InflowOnboarder (Admin)',
    features: [
      { title: 'Overview', purpose: 'InflowOnboarder automates Microsoft 365 account provisioning for joiners and deprovisioning for leavers, with optional scheduling to run actions on future dates.', steps: [
        'InflowOnboarder is an add-on integration. Your company must have an InflowOnboarder subscription enabled before you can connect.',
        'Once connected, M365 automation appears on the onboarding workflow (accounts step) and the offboarding workflow (remove accounts step).',
        'Follow the steps below in order to set up both joiners and leavers.',
      ], callout: { type: 'note', text: 'You need an InflowOnboarder account with an API key before starting. Visit the InflowOnboarder dashboard to create one.' } },

      { title: 'Step 1: Create Your API Key', purpose: 'Generate an API key in InflowOnboarder with the correct permissions for both joiners and leavers.', steps: [
        'Sign in to the InflowOnboarder dashboard.',
        'Go to API Keys and click Create Key.',
        'Select the following scopes:',
        '• m365.joiner — provision new joiner accounts.',
        '• m365.leaver — deprovision leaver accounts.',
        '• m365.license.list — read available licences.',
        'If you also want scheduled (future-dated) provisioning, additionally select:',
        '• hr.joiner — schedule new joiner provisioning.',
        '• hr.leaver — schedule leaver deprovisioning.',
        'Set approvals to "Approved in this service" — InflowHR handles its own approval workflow.',
        'Copy the generated key (it starts with ifo_). You will not be able to see it again.',
      ], callout: { type: 'tip', text: 'Scopes cannot be added to an existing key. If you need to add leavers or scheduling later, create a new key with all the scopes you need and reconnect.' } },

      { title: 'Step 2: Connect the API Key', purpose: 'Paste your API key into InflowHR to establish the connection.', steps: [
        'Go to Admin > Integrations and find the InflowOnboarder card.',
        'Click the card to expand it, then click Connect (or Reconnect if replacing an existing key).',
        'Paste your API key and click Connect.',
        'If the connection succeeds, the status badge shows "Connected" in green.',
        'If M365 read/write is not fully healthy, the status shows "Attention needed" — check your InflowOnboarder dashboard.',
      ] },

      { title: 'Step 3: Configure Onboarding Settings', purpose: 'Set the defaults that apply whenever a new joiner\'s M365 account is provisioned.', steps: [
        'On the InflowOnboarder card, click Onboarding Settings to expand the panel.',
        '',
        'Provisioning Approver — choose who approves each M365 provisioning:',
        '• Joiner\'s manager — the new starter\'s line manager approves.',
        '• Nominated person — enter a specific approver name and email.',
        '',
        'Licence Manager — enter the name and email of the person to notify if M365 licence seats run out.',
        '',
        'Default Licence Type — click "Load Licences" to fetch your M365 licence plans, then select the licence to assign to each new joiner (e.g. Microsoft 365 Business Basic).',
        '',
        'New Joiner Group — optionally enter the M365 group to add each new account to (e.g. "All Staff").',
        '',
        'Account Domain — enter the domain for new account email addresses (e.g. contoso.com).',
        '',
        'Click Save Settings.',
      ], callout: { type: 'note', text: 'Account Domain is required. The card shows "Settings incomplete" until this is set.' } },

      { title: 'Step 4: Configure Offboarding Settings', purpose: 'Set who approves M365 offboarding when an employee leaves.', steps: [
        'On the InflowOnboarder card, click Offboarding Settings to expand the panel.',
        '',
        'Offboarding Approver — choose who approves each M365 offboarding:',
        '• Same as joiner approver — uses the same approver you set in Onboarding Settings.',
        '• Leaver\'s manager — the leaving employee\'s line manager approves.',
        '• Nominated person — enter a specific approver name and email.',
        '',
        'Click Save Settings.',
      ], callout: { type: 'tip', text: 'The approver must exist as an employee in InflowHR for the same company. If the approver cannot be found, check that their email matches their employee record.' } },

      { title: 'Step 5: Verify the Connection', purpose: 'Confirm everything is working before you start using the integration.', steps: [
        'Click Re-check Status on the InflowOnboarder card.',
        'A successful check shows "M365 connection healthy".',
        'If you added scheduling scopes (hr.joiner, hr.leaver), a green "Scheduling" badge appears next to the Connected badge.',
        'If scheduling scopes are missing, an orange hint explains which scopes to add and how.',
      ] },

      { title: 'Using Joiners: Run Now', purpose: 'Provision a new starter\'s M365 account immediately.', steps: [
        'Go to Admin > Onboarding and open a joiner\'s record.',
        'In the workflow, open the accounts step.',
        'Fill in the UPN (sign-in email), display name, and country.',
        'Select a licence and group if different from the defaults.',
        'Click Send for Approval. The configured approver receives a notification.',
        'Once approved, click Proceed. The engine creates the account, assigns the licence, and adds the group.',
        'The panel auto-refreshes while the engine processes — no manual action needed.',
      ] },

      { title: 'Using Joiners: Schedule', purpose: 'Schedule the new starter\'s M365 account to be created ahead of their start date.', steps: [
        'This requires the M365 Scheduling subscription add-on and hr.joiner scope on the API key.',
        'Open the joiner\'s accounts step and switch the mode toggle to Schedule.',
        'Set "Prepare days before" (1–14, default 3) — how many days before the start date the account is created with sign-in disabled.',
        'Review the plan preview:',
        '• Prepare account — N days before the start date at 09:00.',
        '• Enable sign-in — on the start date at 08:00.',
        'Click Send Schedule for Approval.',
        'Once approved, click Create Schedule. The engine confirms the stages and runs automatically on the planned dates.',
      ], callout: { type: 'note', text: 'If you don\'t see the Schedule toggle, check Admin > Integrations for a hint about missing API key permissions.' } },

      { title: 'Using Leavers: Run Now', purpose: 'Deprovision a leaver\'s M365 account immediately.', steps: [
        'Go to Admin > Onboarding > Offboarding tab and open the leaver\'s record.',
        'In the remove accounts step, click Start M365 Offboarding.',
        'The engine checks the employee\'s M365 account status.',
        'If the account is protected (e.g. litigation hold), a warning is shown — resolve externally, then click Re-check.',
        'Once the check passes, click Send for Approval.',
        'Once approved, click Proceed with Offboarding. The engine blocks sign-in, removes groups, and revokes licences.',
      ] },

      { title: 'Using Leavers: Schedule', purpose: 'Schedule M365 account removal around the leave date.', steps: [
        'This requires the M365 Scheduling subscription add-on and hr.leaver scope on the API key.',
        'Open the leaver\'s remove accounts step and switch the mode toggle to Schedule.',
        'Set "Licence removal delay" (0–90 days, default 30) — how long after the leave date groups and licences are removed.',
        'Review the plan preview:',
        '• Block access — blocks sign-in at 17:00 on the leave date.',
        '• Remove groups & licence — N days after the leave date at 17:00.',
        'Click Send Schedule for Approval.',
        'Once approved, click Create Schedule. The engine runs automatically on the planned dates.',
      ] },

      { title: 'Workflow Statuses', purpose: 'Understand what each status means during joiner and leaver workflows.', steps: [
        'Checking Account — the engine is verifying the M365 account.',
        'Account Blocked — the account is protected and cannot be processed automatically.',
        'Ready for Approval — checks passed, waiting for you to send for approval.',
        'Awaiting Approval — approval sent, waiting for the approver to respond.',
        'Provisioning / Deprovisioning — the engine is creating or removing the account.',
        'Completed — all actions finished successfully.',
        'Failed — something went wrong. Use Re-check or Mark Complete Manually.',
      ] },

      { title: 'Schedule Statuses', purpose: 'Understand what each status means during scheduled provisioning or deprovisioning.', steps: [
        'Pending Approval — waiting for the approver to approve or decline.',
        'Scheduled — the engine has accepted the schedule and will execute on the planned dates.',
        'Running — a stage is currently being executed.',
        'Blocked — something is preventing the next stage (e.g. no available licence). Resolve the issue, then click Check Again.',
        'Completed — all stages finished successfully.',
        'Cancelled — an admin cancelled the schedule.',
        'Failed — the engine encountered an error. Check the message, then use Check Again or cancel.',
        'Missed — a stage\'s planned time passed without executing. Use Check Again to retry.',
      ] },

      { title: 'Managing Active Schedules', purpose: 'Monitor, refresh, or cancel schedules after they are created.', steps: [
        'The schedule tracking panel shows a timeline with each stage, its planned date/time, and current status.',
        'Refresh — re-fetches the latest status from the engine.',
        'Check Again — retries a blocked or failed stage after you\'ve resolved the issue externally.',
        'Cancel — cancels the schedule with a reason. Any resources already provisioned (e.g. licences) are released.',
      ], callout: { type: 'tip', text: 'If a joiner\'s start date or leaver\'s end date changes, update the date on the record first, then cancel and re-create the schedule with the new dates.' } },

      { title: 'Manual Completion', purpose: 'Mark a joiner or leaver as complete when the automated workflow cannot finish.', steps: [
        'If the workflow fails or the account was handled outside the automated process, click Mark Complete Manually.',
        'This updates the record to Completed without calling the InflowOnboarder engine.',
      ], callout: { type: 'tip', text: 'Manual completion is always available as a fallback — no record is ever stuck.' } },

      { title: 'Troubleshooting', purpose: 'Common issues and how to resolve them.', steps: [
        '"Could not find the approver employee record" — the approver\'s email does not match any employee in your company. Check the approver email matches their employee record\'s email or user email.',
        '"Scheduling not available" — the API key is missing the hr.joiner and hr.leaver scopes. Create a new key with all required scopes and reconnect.',
        '"M365 Not Fully Ready" — the API key is valid but M365 read/write connections are not both healthy. Check your InflowOnboarder dashboard.',
        '"Account Blocked" — the M365 account has a protection (e.g. litigation hold). Remove the hold in the Microsoft 365 admin centre, then click Re-check.',
        '"Settings incomplete" — the Account Domain field is empty. Open Onboarding Settings and enter your domain.',
      ] },

      { title: 'Movers & Personas', purpose: 'Understand how role changes and persona-driven M365 updates work.', steps: [
        'Personas are configured in InflowOnboarder (Templates > Persona packs). InflowHR shows the personas that are enabled and ready in the engine.',
        'When an employee changes role or persona, InflowHR creates a Role Change record and optionally triggers an M365 update via InflowOnboarder.',
        'The engine updates the employee\'s profile, groups, licence, and extensionAttribute1 in Microsoft 365.',
        'Dynamic groups in Entra ID re-evaluate automatically based on extensionAttribute1, so Intune policies and conditional access apply without manual steps.',
        '',
        'Company Device Requirement:',
        'Persona changes are only available for employees who have a managed company device (e.g. a laptop or phone enrolled in Entra ID / Intune).',
        'If you do not have a company device, the persona picker is disabled and shows "No company device assigned — persona changes not applicable".',
        'Your admin can toggle the company device flag on your employee record. It is also set automatically when the equipment step is completed during onboarding.',
      ], callout: { type: 'note', text: 'Persona packs are set up in InflowOnboarder. InflowHR displays whatever personas the engine reports as enabled and ready. Persona changes require a managed company device.' } },

      { title: 'Starting a Role Change', purpose: 'Create a mover record when an employee changes role, department, or persona.', steps: [
        'Go to Admin > Onboarding > Movers tab.',
        'Search for the employee and click their name.',
        'Fill in the change details: change type, effective date, new values for changed fields.',
        'When adding manager name or manager email as a change, the other field is automatically included — they are always updated together to prevent data gaps.',
        'If the persona is changing, select the new persona from the engine-driven picker. Only personas marked "ready" in the engine can be selected.',
        'If the employee does not have a company device, persona changes are disabled with an amber warning explaining why.',
        'Add a reason for the change and click Create Role Change.',
        'The mover workflow opens with six steps: Review Changes, Update M365 Account, Save Changes to InflowHR, Notify Team / Manager, Review Remaining Access, and Confirm Complete.',
      ] },

      { title: 'Mover M365 Workflow', purpose: 'How the engine updates M365 during a role change.', steps: [
        'In the Update M365 Account step, InflowHR sends the role change details to the engine.',
        'This includes profile updates (job title, department), group add/remove, licence swap, and extensionAttribute1.',
        'Click Start M365 Update to send the changes to the engine.',
        'The engine checks the account, then returns a plan showing what will change.',
        'Send for approval — the configured Mover Approver receives a notification card.',
        'Once approved, click Proceed. The engine applies all changes.',
        'If the employee is crossing a security boundary (to or from Secure VIP), all active sessions are revoked automatically.',
      ] },

      { title: 'Persona at Onboarding', purpose: 'Assign a persona when creating a new starter.', steps: [
        'When creating a new starter in Admin > Onboarding, a Persona section appears if InflowOnboarder is connected.',
        'Select the appropriate persona from the list provided by the engine (defaults to Information worker).',
        'Personas that are not yet ready in the engine are greyed out with a setup message.',
        'The selected persona is stored on the onboarding record and applied to the employee record when onboarding completes.',
      ] },

      { title: 'Change Detection on Employee Edit', purpose: 'InflowHR detects role-relevant changes when you edit an employee and protects JML-controlled fields.', steps: [
        'When InflowOnboarder is connected, key fields are locked on the employee edit form to prevent changes being made outside the Mover workflow:',
        '• Job title and department (inline table editing is disabled)',
        '• Location, manager name, and manager email (edit form fields show a lock icon with "Mover workflow")',
        'An amber banner explains: "Job title, department, location and manager are locked — use the Mover workflow in JML to change these fields so that M365 and HR records stay in sync."',
        '',
        'For non-locked fields (e.g. persona), the system still detects changes on save:',
        '"Would you like to start a role change to update their Microsoft 365 account?"',
        'Click "Yes — Go to Movers" to create a role change record and navigate to the Movers workflow.',
        'Click "No — HR Record Only" to save the changes without triggering an M365 update.',
        'The mover prompt only appears when the employee has a company device assigned.',
      ], callout: { type: 'tip', text: 'Field locking ensures all JML-relevant changes go through the Mover workflow, keeping old/new values tracked for cancel/revert. Without InflowOnboarder connected, all fields are editable as normal.' } },
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
