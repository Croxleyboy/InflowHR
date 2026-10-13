-- Migration: 185_employee_help_expand
-- Description: Add FAQ articles for kudos, elearning, timesheets, rooms, meetings and expand existing categories

-- =============================================================================
-- NEW CATEGORIES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- KUDOS (sort_order 1-10)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$How do I give kudos to a colleague?$$, $$Go to the sidebar and select Kudos, then click Give Kudos. Choose the colleague you want to recognise, select a category such as teamwork or going above and beyond, and write a short message explaining why. Your kudos will be visible to their manager and the team.$$, $$recognition shoutout praise thank colleague appreciate$$, 1, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$Where can I see kudos I have received?$$, $$Go to the sidebar and select Kudos, then click the Received tab. You will see all kudos messages sent to you, including who sent them and when. You can also filter by date range or category.$$, $$received recognition view praise history$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$Can I give kudos to someone in a different department?$$, $$Yes, you can give kudos to any colleague in your organisation regardless of their department or team. Cross-department recognition is encouraged and helps build a positive workplace culture.$$, $$cross department team different recognition peer$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$What categories of kudos can I choose from?$$, $$InflowHR provides several kudos categories including Teamwork, Innovation, Customer Focus, Going Above and Beyond, Leadership, and Problem Solving. Your company may have added custom categories as well.$$, $$type category badge award kind recognition$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$Does my manager see the kudos I receive?$$, $$Yes, managers can see all kudos received by their direct reports. Kudos are also visible in performance review summaries, so they can be used as supporting evidence during appraisals.$$, $$manager visible performance review appraisal$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$Can I edit or delete a kudos message I sent?$$, $$You can edit or delete a kudos message within 24 hours of sending it. Go to the Kudos section, click the Sent tab, find the message, and select Edit or Delete from the options menu.$$, $$edit delete remove change sent kudos undo$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$Is there a limit to how many kudos I can give?$$, $$There is no limit to the number of kudos you can give. We encourage you to recognise colleagues whenever you see great work. However, each kudos should be meaningful and specific rather than generic.$$, $$limit maximum number how many restriction$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$How do I nominate someone for an employee award?$$, $$Some organisations link their kudos system to employee awards. If your company has this enabled, you will see a Nominate for Award option when giving kudos. Your nomination will be reviewed by the awards committee.$$, $$nominate award employee month recognition special$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$Can I see a leaderboard of kudos in my team?$$, $$Go to the sidebar and select Kudos, then click the Leaderboard tab. You can view the top recognised individuals in your team or across the whole organisation, filtered by week, month, or quarter.$$, $$leaderboard top ranking team recognition stats$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$Will I get a notification when someone gives me kudos?$$, $$Yes, you will receive an in-app notification and an email when someone gives you kudos. You can manage your notification preferences in Settings under Notifications.$$, $$notification alert email push kudos received$$, 10, NULL);

-- -----------------------------------------------------------------------------
-- ELEARNING (sort_order 1-10)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$How do I access my training courses?$$, $$Go to the sidebar and select eLearning. You will see your enrolled courses, recommended courses, and any mandatory training assigned to you. Click on a course to start or continue learning.$$, $$training course access start learning module$$, 1, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$How do I enrol on a new course?$$, $$Go to the sidebar and select eLearning, then click Browse Courses. Find the course you want and click Enrol. Some courses may require manager approval before you can start.$$, $$enrol register sign up join course new$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$Where can I see my training certificates?$$, $$Go to the sidebar and select eLearning, then click the Certificates tab. All certificates for completed courses are listed there. You can download or print individual certificates as needed.$$, $$certificate completed qualification proof download$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$I have mandatory training overdue — what should I do?$$, $$Mandatory training must be completed by the deadline shown. Go to eLearning from the sidebar and look for courses marked with a red Overdue badge. Complete them as soon as possible, as your manager and HR will be notified of overdue training.$$, $$mandatory required overdue deadline compliance$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$How do I track my progress on a course?$$, $$Open the course from the eLearning section and you will see a progress bar showing how many modules you have completed. Each module is marked as complete, in progress, or not started.$$, $$progress tracking percentage modules complete status$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$Can I retake a course or assessment?$$, $$Yes, most courses allow you to retake them. Go to the eLearning section, find the completed course, and click Retake. Some compliance courses have a set retake schedule managed by your HR team.$$, $$retake redo repeat assessment quiz again$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$What mandatory training is required for my role?$$, $$Your mandatory training requirements depend on your role and department. Go to the sidebar and select eLearning, then click Mandatory Training to see all courses assigned to you with their due dates.$$, $$mandatory required compliance role health safety$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$How do I request a new training course?$$, $$If you would like to take a course that is not listed, go to eLearning and click Request Course. Fill in the details of the training you need and submit it for your manager to review and approve.$$, $$request new course suggest training development$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$Can I access eLearning courses on my mobile?$$, $$Yes, InflowHR eLearning is fully responsive and works on mobile devices and tablets. Simply log in through your mobile browser and navigate to the eLearning section as you would on desktop.$$, $$mobile phone tablet device responsive access$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$elearning$$, $$How does my completed training appear on my profile?$$, $$All completed courses and certificates are automatically added to your employee profile under the Training and Development section. Your manager and HR can view your training history during reviews.$$, $$profile record history completed training development$$, 10, NULL);

-- -----------------------------------------------------------------------------
-- TIMESHEETS (sort_order 1-10)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$How do I log my hours on a timesheet?$$, $$Go to the sidebar and select Timesheets. Choose the current week and enter your start time, end time, and any breaks for each day. Click Save to store your entries, then Submit when your week is complete.$$, $$log hours record time entry work$$, 1, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$When is the deadline for submitting my timesheet?$$, $$Timesheets should be submitted by the end of the working week, typically by Friday at 17:00. Late submissions may delay payroll processing. Check with your manager if you are unsure of your specific deadline.$$, $$deadline due date submit when weekly$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$How do I correct a mistake on a submitted timesheet?$$, $$If your timesheet has already been submitted, go to the Timesheets section and find the relevant week. Click Request Amendment and describe the correction needed. Your manager will review and approve the change.$$, $$correct error mistake amend change fix$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$Who approves my timesheet?$$, $$Your timesheet is submitted to your line manager for approval. You will receive a notification once it has been approved or if any changes are requested. You can check the status in the Timesheets section.$$, $$approve manager authorise review status$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$How do I log overtime hours?$$, $$When entering your timesheet, record all hours worked including overtime. Hours beyond your contracted hours will automatically be flagged as overtime. Your manager must approve overtime before it is processed for payment.$$, $$overtime extra hours additional time worked$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$Can I copy a previous week's timesheet?$$, $$Yes, go to the Timesheets section and click Copy Previous Week when starting a new timesheet. This will pre-fill your hours based on the last submitted week. You can then adjust any days as needed before submitting.$$, $$copy duplicate previous week template repeat$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$What happens if I forget to submit my timesheet?$$, $$You will receive reminder notifications before the deadline. If you miss the deadline, your timesheet may need to be submitted as a late entry, which requires manager approval. Repeated late submissions may affect payroll processing.$$, $$forgot late missed deadline reminder overdue$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$How do I add a break to my timesheet?$$, $$When logging your hours for each day, use the Break field to enter the duration of your break in minutes. Breaks are automatically deducted from your total working hours for that day.$$, $$break lunch rest deduct pause$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$Where can I view my timesheet history?$$, $$Go to the sidebar and select Timesheets, then click the History tab. You can filter by date range and see all previously submitted timesheets along with their approval status.$$, $$history previous past records view old$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$timesheets$$, $$Are my timesheets used for payroll calculations?$$, $$Yes, approved timesheets feed directly into payroll calculations. Your logged hours, including any overtime or adjustments, determine your pay for each period. This is why timely and accurate submission is important.$$, $$payroll pay calculation wages salary hours$$, 10, NULL);

-- -----------------------------------------------------------------------------
-- ROOMS (sort_order 1-10)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$How do I book a meeting room?$$, $$Go to the sidebar and select Rooms. Choose the date and time you need, and you will see available rooms. Click on a room to view its details and capacity, then click Book to reserve it.$$, $$book reserve meeting room space$$, 1, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$How do I cancel a room booking?$$, $$Go to the Rooms section and click My Bookings. Find the booking you want to cancel and click Cancel Booking. The room will be released and made available for others. Please cancel as early as possible.$$, $$cancel remove delete booking release$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$How do I check which rooms are available right now?$$, $$Go to the sidebar and select Rooms. The default view shows current availability with green indicators for free rooms and red for occupied rooms. You can also filter by capacity and facilities.$$, $$available free now today check open$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$What equipment is available in each meeting room?$$, $$Each room listing shows its available equipment such as a projector, whiteboard, video conferencing, or phone. Go to the Rooms section and click on a room name to see the full list of facilities.$$, $$equipment projector whiteboard video facilities$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$Can I book a room for a recurring meeting?$$, $$Yes, when making a booking select the Recurring option. You can set the meeting to repeat daily, weekly, fortnightly, or monthly. Each occurrence will be booked automatically if the room is available.$$, $$recurring repeat regular weekly daily series$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$How far in advance can I book a meeting room?$$, $$Room bookings can typically be made up to 4 weeks in advance. Some high-demand rooms may have shorter booking windows. Check the room details for any specific restrictions.$$, $$advance future how far ahead weeks booking window$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$Can I extend my current room booking?$$, $$If the room is free after your booking, you can extend it from the Rooms section. Find your active booking and click Extend. Choose the additional time needed. If the room is booked after yours, you will need to find an alternative.$$, $$extend longer more time continue overrun$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$How do I report a problem with a meeting room?$$, $$If equipment is broken or the room needs attention, go to the Rooms section, find the room, and click Report Issue. Describe the problem and it will be sent to your facilities team for resolution.$$, $$report problem issue broken fault maintenance$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$Can I book a room at a different office location?$$, $$Yes, if your organisation has multiple office locations, use the Location filter in the Rooms section to switch between sites. You can book rooms at any location your organisation has set up.$$, $$location office site different branch other$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$rooms$$, $$What is the maximum capacity of each room?$$, $$Room capacity is displayed on each room card in the Rooms section. You can filter rooms by minimum capacity to quickly find a room that fits your group size.$$, $$capacity size people seats maximum fit$$, 10, NULL);

-- -----------------------------------------------------------------------------
-- MEETINGS (sort_order 1-10)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$How do I schedule a 1:1 meeting with my manager?$$, $$Go to the sidebar and select Meetings, then click Schedule 1:1. Select your manager and choose a date and time. You can add an agenda and any discussion points before sending the invite.$$, $$schedule book 1:1 one to one manager$$, 1, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$Where can I see my upcoming meetings?$$, $$Go to the sidebar and select Meetings to view all your scheduled meetings. The calendar view shows dates and times, and you can switch to list view for a chronological overview.$$, $$upcoming scheduled diary calendar view$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$How do I add notes to a meeting?$$, $$Open the meeting from the Meetings section and click the Notes tab. You can add notes before, during, or after the meeting. Both you and your manager can contribute notes, which are saved automatically.$$, $$notes record minutes write add meeting$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$How do I reschedule a meeting?$$, $$Go to the Meetings section, find the meeting you want to change, and click Reschedule. Select a new date and time and confirm. The other attendee will be notified of the change automatically.$$, $$reschedule move change date time postpone$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$What should I discuss in my 1:1 meeting?$$, $$Common 1:1 topics include progress on current objectives, any blockers or challenges, development goals, feedback, and wellbeing. You can add agenda items in advance through the meeting's Agenda tab in InflowHR.$$, $$topics agenda discuss 1:1 one to one points$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$How do I set up recurring 1:1 meetings?$$, $$When scheduling a 1:1 meeting, select the Recurring option and choose the frequency — weekly, fortnightly, or monthly. Each meeting in the series will appear in your Meetings calendar with its own notes and agenda.$$, $$recurring regular repeat 1:1 weekly monthly$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$How do I prepare for a performance review meeting?$$, $$Before your performance review, go to the Meetings section and open the review meeting. Review your objectives, update any progress notes, and prepare evidence of achievements. You can also review any kudos or feedback you have received.$$, $$performance review prepare appraisal annual$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$Can my manager see my meeting notes?$$, $$Meeting notes are shared between you and the other attendees. Both parties can view and edit notes within the meeting record. If you need private notes, use the Private Notes section which is only visible to you.$$, $$private visible shared manager notes see$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$How do I add action items from a meeting?$$, $$Open the meeting from the Meetings section and click the Actions tab. Click Add Action, describe the task, assign it to yourself or another attendee, and set a due date. Actions will appear in your task list.$$, $$action items tasks follow up todo assign$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$meetings$$, $$How do I cancel a scheduled meeting?$$, $$Go to the Meetings section, find the meeting you want to cancel, and click Cancel Meeting. Add a reason if required and confirm. The other attendee will receive a cancellation notification.$$, $$cancel remove delete meeting stop$$, 10, NULL);

-- =============================================================================
-- EXPAND EXISTING CATEGORIES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BENEFITS (sort_order 20-30)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$How does pension auto-enrolment work?$$, $$Under UK law, eligible employees are automatically enrolled into a workplace pension scheme. Contributions are deducted from your pay each month. You can view your pension details in the Benefits section from the sidebar.$$, $$pension auto enrolment retirement contributions workplace$$, 20, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$Can I opt out of the workplace pension?$$, $$Yes, you can opt out of the pension within one month of being enrolled. Go to the Benefits section and click Pension, then select Opt Out. Note that your employer is required to re-enrol you every three years.$$, $$opt out pension leave stop contributions$$, 21, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What childcare benefits are available?$$, $$Your company may offer childcare vouchers or the Tax-Free Childcare scheme. Go to the sidebar and select Benefits, then click Childcare to see what is available. These schemes can help reduce the cost of registered childcare.$$, $$childcare vouchers nursery kids children tax free$$, 22, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$How do I sign up for the Cycle to Work scheme?$$, $$Go to the sidebar and select Benefits, then click Cycle to Work. You can choose a bicycle and accessories through the scheme and pay via salary sacrifice over 12 months, saving on tax and National Insurance.$$, $$cycle work bike bicycle salary sacrifice$$, 23, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What health insurance cover do I have?$$, $$Your health insurance details are available in the Benefits section under Health Cover. You can view your level of cover, any dependants included, and how to make a claim. Contact your HR team if you need to update your cover.$$, $$health insurance medical cover private PMI BUPA$$, 24, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$Am I entitled to free eye care or eye tests?$$, $$If you use a display screen for a significant part of your work, your employer must provide a free eye test. Some companies also contribute towards glasses. Check the Benefits section under Eye Care for your entitlements.$$, $$eye test glasses vision display screen DSE$$, 25, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What wellbeing support is available?$$, $$Many organisations offer an Employee Assistance Programme (EAP) providing confidential counselling and support. Go to the Benefits section and click Wellbeing to see available resources including mental health support, financial advice, and helplines.$$, $$wellbeing mental health EAP counselling support stress$$, 26, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$How do I increase my pension contributions?$$, $$To change your pension contribution level, go to the Benefits section and click Pension. Select Change Contributions and choose your new percentage. Changes typically take effect from the next pay period.$$, $$pension increase contributions more percentage raise$$, 27, NULL);

-- -----------------------------------------------------------------------------
-- SHIFTS (sort_order 20-30)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How do I request a shift swap with a colleague?$$, $$Go to the sidebar and select Shifts, find the shift you want to swap, and click Swap Request. Choose the colleague you want to swap with and select their shift. Both parties and your manager must approve the swap.$$, $$swap exchange trade shift colleague switch$$, 20, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How do I request a correction to a past shift?$$, $$Go to the Shifts section and find the shift that needs correcting. Click Request Correction and describe what needs to change — for example, an incorrect start or end time. Your manager will review and approve the amendment.$$, $$correction error wrong time amend fix shift$$, 21, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$Where can I view my rota for the coming weeks?$$, $$Go to the sidebar and select Shifts to see your rota. You can switch between day, week, and month views. Future shifts that have been published by your manager will appear on the calendar.$$, $$rota schedule roster view upcoming future$$, 22, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How do I set my availability for shifts?$$, $$Go to the Shifts section and click Availability. Mark the days and times you are available or unavailable for each week. Your manager will see your availability when creating the rota.$$, $$availability preference unavailable days times set$$, 23, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How is overtime calculated on my shifts?$$, $$Overtime is typically calculated for any hours worked beyond your contracted hours per week. Go to the Shifts section and click Hours Summary to see a breakdown of your standard and overtime hours for the current period.$$, $$overtime extra hours calculation pay rate$$, 24, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$Where can I see my contracted hours?$$, $$Your contracted hours are shown in your employee profile under Contract Details. Go to the sidebar, select My Profile, and click the Contract tab. This shows your weekly hours, pattern, and any flexible working arrangements.$$, $$contracted hours weekly pattern employment terms$$, 25, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$I am on a zero-hours contract — how does shift allocation work?$$, $$If you are on a zero-hours contract, your manager will offer shifts based on business need and your stated availability. You are not obliged to accept every shift offered. Check the Shifts section regularly for new shift offers.$$, $$zero hours contract casual flexible no guaranteed$$, 26, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How do I pick up an open shift?$$, $$Go to the Shifts section and click Open Shifts to see any unfilled shifts available at your location. Click the shift and select Pick Up to express your interest. Your manager will confirm the allocation.$$, $$open shift pick up available extra take$$, 27, NULL);

-- -----------------------------------------------------------------------------
-- PERFORMANCE (sort_order 20-30)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How do I set my performance objectives?$$, $$Go to the sidebar and select Performance, then click Objectives. Click Add Objective and enter a title, description, and target completion date. Align each objective with your team or company goals. Your manager will review and approve them.$$, $$objectives goals targets set create KPI OKR$$, 20, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$When is my next appraisal?$$, $$Your next appraisal date is shown in the Performance section under Appraisals. You will also receive a notification in advance. If no date is set, speak with your manager to schedule your review.$$, $$appraisal review date next when annual$$, 21, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How does 360-degree feedback work?$$, $$360-degree feedback collects input from your manager, peers, and direct reports. When a 360 review is initiated, selected colleagues are invited to provide anonymous feedback. You will see a summary report in the Performance section once complete.$$, $$360 feedback peer review multi rater anonymous$$, 22, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How do I create a personal development plan?$$, $$Go to the sidebar and select Performance, then click Development Plans. Click Create Plan and add development areas, actions, resources needed, and target dates. Share the plan with your manager for discussion during your next 1:1.$$, $$development plan PDP learning growth career$$, 23, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$What happens during a probation review?$$, $$Probation reviews are scheduled meetings to assess your performance during your probationary period. Your manager will discuss your progress, any concerns, and whether your probation will be confirmed, extended, or ended. Details are in the Performance section.$$, $$probation review trial period new starter assessment$$, 24, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How do I update progress on my objectives?$$, $$Go to the Performance section and click Objectives. Select the objective you want to update and click Update Progress. Add a comment describing your progress and adjust the completion percentage. Your manager can see all updates.$$, $$update progress objective status comment percentage$$, 25, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$Can I give feedback to my manager?$$, $$Yes, InflowHR supports upward feedback. If your company has enabled it, you can provide feedback to your manager through the Performance section under Give Feedback. This feedback may be anonymous depending on your company settings.$$, $$feedback manager upward anonymous give provide$$, 26, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How are performance ratings determined?$$, $$Performance ratings are based on your progress against objectives, feedback received, and your overall contribution. Your manager assigns a rating during your appraisal, which you can view and discuss in the Performance section.$$, $$rating score grade appraisal assessment evaluation$$, 27, NULL);

-- =============================================================================
-- SEARCH ANALYTICS TABLE
-- =============================================================================

CREATE TABLE help_search_logs (
  id SERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  matched BOOLEAN NOT NULL DEFAULT false,
  result_count INT NOT NULL DEFAULT 0,
  top_article_id INT REFERENCES help_articles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_help_search_logs_company ON help_search_logs(company_id);
CREATE INDEX idx_help_search_logs_created ON help_search_logs(created_at);

ALTER TABLE help_search_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY help_search_logs_insert ON help_search_logs FOR INSERT
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY help_search_logs_select ON help_search_logs FOR SELECT
  USING (company_id = get_my_company_id() AND is_company_admin() OR is_super_admin());
