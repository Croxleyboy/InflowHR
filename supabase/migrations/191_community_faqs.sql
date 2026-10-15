-- Migration: 191_community_faqs
-- Description: Add community FAQ articles for AI helper knowledge base
-- These are conversational, practical answers for common employee questions
-- All validated against actual InflowHR functionality

-- =============================================================================
-- ACCESS & LOGIN (category: account, sort_order 100-103)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$account$$, $$I signed in but I am getting an Access Denied screen — what is going on?$$, $$This usually means your company has not been set up on InflowHR yet, or you are signing in with an email address that does not match your company's registered domain. Check with your HR team that your organisation is registered and that you are using the correct work email. If you have recently changed your email address at work, your old one might still be the one linked to your account.$$, $$access denied blocked login sign in domain email company not setup$$, 100, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$account$$, $$I can log in but everything is empty — no dashboard, no leave, nothing.$$, $$This typically means your admin has created your account but has not finished setting up your employee profile or assigning you to the right company. Ask your HR admin to check your employee record is linked and that your company's features are enabled.$$, $$empty blank dashboard nothing showing no data profile not linked$$, 101, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$account$$, $$My company uses Microsoft 365 or Google Workspace — do I need a separate password for InflowHR?$$, $$No — if your company has SSO enabled, you sign in with your existing Microsoft or Google account. One click, no extra password to remember. If your company does not use SSO, you will have been given login details during onboarding.$$, $$SSO single sign on Microsoft Google password login separate account$$, 102, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$account$$, $$I left the company and came back — can I still get into my old account?$$, $$It depends on how your company handled your offboarding. If your record was frozen (not permanently deleted), your HR admin can reactivate you and your history will still be there. If it was deleted after the retention period, you will be starting fresh as a new employee.$$, $$returning employee rejoined rehired old account reactivate offboarding$$, 103, NULL);

-- =============================================================================
-- LEAVE (category: leave, sort_order 100-104)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$I tried to book a day off but it says I do not have enough allowance — I am sure I do.$$, $$Check which leave type you are selecting — your balance is shown per type (annual leave, sick leave, etc.) and each has its own allowance. Also check whether you have any pending requests that have not been approved yet, as those count against your remaining balance too. Some leave types like compassionate leave do not deduct from your allowance — your admin configures which ones do.$$, $$not enough allowance balance insufficient leave rejected pending deducted$$, 100, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$I submitted a leave request three days ago and it is still showing as Pending.$$, $$Your manager needs to approve or decline the request from their Actions queue. They will have received a notification, but if it has been a while, it is worth giving them a nudge. You can see exactly who the request is waiting on in your leave history.$$, $$pending waiting approval manager not approved leave request stuck$$, 101, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$I need to cancel a leave request I already submitted — can I do that?$$, $$If it is still Pending you can cancel it yourself from your leave history. If it has already been approved, you can also request cancellation — your manager will be notified and your allowance will be restored once it is cancelled.$$, $$cancel withdraw remove leave request undo approved pending$$, 102, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$I am off sick today — is there a quick way to let people know without filling in a full form?$$, $$Yes — use the I'm Off button on the Leave page. It creates a sick leave request and sends an instant notification to your manager, so they know you are out without you having to go through the full leave request process.$$, $$sick today quick absence notify im off button instant$$, 103, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$Half the team booked the same week off and now I cannot — can I see who is off before I book?$$, $$The Leave Calendar shows you at a glance who has already booked off and when. Check it before you submit your request so you can pick dates that do not clash — especially useful around school holidays and bank holidays. You can search for specific people or use the watchlist to track your team.$$, $$team calendar who is off clash overlap leave calendar watchlist$$, 104, NULL);

-- =============================================================================
-- EXPENSES (category: expenses, sort_order 100-103)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$expenses$$, $$I accidentally submitted my expense claim before I had finished adding everything — can I edit it?$$, $$Once a claim is submitted it is locked for approval. You will need to ask your manager or HR admin to decline it so you can resubmit with the extra items. Next time, save it as a Draft first — you can keep adding line items and submit when you are ready.$$, $$edit submitted expense claim locked change add more draft resubmit$$, 100, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$expenses$$, $$My receipt photo is blurry — will my claim get rejected?$$, $$That is down to your finance team's policy — InflowHR does not reject claims automatically based on image quality. But a blurry receipt is harder for your approver to verify, so it is worth retaking the photo. Make sure the amount, date and vendor are legible before you attach it.$$, $$blurry receipt photo image quality rejected unclear expense$$, 101, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$expenses$$, $$My expense claim was rejected but there is no reason given — who do I ask?$$, $$Check the notification you received — sometimes there is a note from the approver. If not, the quickest route is to raise an HR ticket directly in the app with the claim reference number. Your finance or HR team can then explain the reason and advise whether to resubmit.$$, $$rejected expense no reason why declined claim query HR ticket$$, 102, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$expenses$$, $$I have got a pile of receipts from last month — is there a quick way to log them all?$$, $$Create a single expense claim and add each receipt as a separate line item — you can snap photos one after the other from your phone. Keep it as a draft until you have got everything in, then submit the whole batch in one go. It saves both you and your approver time.$$, $$multiple receipts batch bulk expense claim quick log many$$, 103, NULL);

-- =============================================================================
-- PAY & TIMESHEETS (category: pay, sort_order 100-103)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$My payslip does not look right — the numbers seem off compared to last month.$$, $$Open both payslips side by side and compare the breakdown — gross pay, tax, NI, pension and any deductions are all itemised. Common reasons for differences include tax code changes, pension contribution adjustments, or bonus payments. If something still does not add up, raise an HR ticket with both payslip dates so payroll can investigate.$$, $$payslip wrong incorrect different numbers changed error compare$$, 100, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$I am getting an overlapping entry error when I try to submit my timesheet.$$, $$This means you have got two timesheet entries covering the same time window. Check your existing entries for the day — you might have a duplicate or one that runs later than you intended. Adjust the times so they do not overlap and you will be able to submit.$$, $$overlapping entry error timesheet duplicate time conflict submit$$, 101, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$I forgot to clock out yesterday — my check-in shows I worked 16 hours!$$, $$If your company has auto-checkout enabled, the system will have clocked you out automatically after a set period. If not, let your manager or HR admin know and they can correct the record. Going forward, try to get in the habit of clocking out when you leave.$$, $$forgot clock out long hours check in auto checkout missed$$, 102, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$I am a solicitor — can I track billable hours against specific clients in here?$$, $$Yes — InflowHR has a dedicated legal timesheets module built for firms that bill by time. You can log hours against specific clients and matters, use a running timer or enter time manually, and your firm sets the rounding and activity codes. It is one of the features that sets InflowHR apart for professional services.$$, $$solicitor legal billable hours client matter timer law firm timesheet$$, 103, NULL);

-- =============================================================================
-- MOBILE (category: general, sort_order 100-103)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$I cannot find InflowHR in the App Store — is there an app?$$, $$InflowHR is a progressive web app — you use it through your phone's browser, no download needed. To add it to your home screen: on iPhone, open it in Safari, tap the share icon, then Add to Home Screen. On Android, tap the three-dot menu in Chrome and choose Add to Home screen. After that it works just like any other app on your phone.$$, $$app store download install PWA progressive web app home screen iPhone Android$$, 100, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$The app looks weird on my phone — text is tiny and I have to scroll sideways.$$, $$You are probably viewing the desktop version. Make sure you are opening InflowHR at the correct URL in your mobile browser. If you have added it to your home screen it will always open in mobile-optimised mode. Try clearing your browser cache if it is still showing the wrong layout.$$, $$mobile layout broken small text zoom scroll phone display wrong$$, 101, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$Can I check in for my shift from my phone when I arrive at work?$$, $$Yes — just open the app and tap check in. If your company has location verification turned on, you will be asked to share your location to confirm you are at the right site. The live timer starts running so you can see your hours building up through the day.$$, $$check in phone mobile shift clock in GPS location arrive$$, 102, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$I switched to dark mode but some screens still look white — is that a bug?$$, $$Toggle dark mode from the moon/sun icon in the top navigation bar within InflowHR. It should apply across all screens. If you are still seeing white patches, try closing the app completely and reopening it. Some browsers cache the old styles, so a hard refresh usually sorts it out.$$, $$dark mode theme light white bug toggle switch night$$, 103, NULL);

-- =============================================================================
-- DAY-TO-DAY (mixed categories, sort_order 104-108)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$I need to swap my shift with a colleague — how does that work?$$, $$Go to Shift Swap from the sidebar, find the shift you want to swap, and request a swap. Your colleague will get a notification and can accept, decline, or counter-offer with a different shift. Once both sides agree, your manager is notified and the rota updates automatically — no back-and-forth texts or emails needed.$$, $$swap shift colleague trade exchange rota notification accept$$, 104, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$I want to book a desk for next week but I cannot see any available — are they all taken?$$, $$Check that you have selected the right location and floor — availability is filtered by those. You can also filter by equipment like a monitor or standing desk which narrows the results. If everything genuinely is booked, try a different floor or day. Your admin controls how far in advance bookings can be made.$$, $$desk booking room space available full taken floor equipment filter$$, 104, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$I have been assigned a mandatory training course — when is the deadline?$$, $$Your personal deadline is shown on the course card in the E-Learning section from the sidebar. It is calculated from when you were enrolled, not a fixed company-wide date, so everyone gets the same amount of time. You will get reminders as the deadline approaches, and some courses renew annually.$$, $$training course mandatory deadline elearning assigned due date enrolled$$, 105, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$kudos$$, $$I want to recognise a colleague who helped me on a project — is there a way to do that?$$, $$Use the Kudos feature from the sidebar — pick the person, choose a category, and write a short message. You can make it public (visible to the whole company feed) or private (just between you and them). Other people can like kudos posts too, so it is a nice way to build a culture of recognition.$$, $$recognise colleague praise thank you well done shoutout appreciation$$, 106, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$I have got a payroll question but I do not know who to ask — is there an internal helpdesk?$$, $$Yes — raise an HR Ticket directly in the app from your Profile page. Select a category and priority, describe your issue, and it gets routed to your HR or payroll team. You can track the status from Open through to Resolved, so you are never left wondering whether anyone is looking at it.$$, $$HR ticket helpdesk query question payroll contact support raise issue$$, 106, NULL);

-- =============================================================================
-- MY DATA / PRIVACY (category: general, sort_order 107-110)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What personal data does InflowHR hold on me — and can I get a copy?$$, $$InflowHR holds the information your employer has added to manage your employment — things like your profile details, leave history, payslips and timesheets. You have the right to download a copy of your own data at any time from your Profile page using the Download My Data button. It is part of the platform's GDPR compliance.$$, $$personal data GDPR download copy privacy DSAR subject access request$$, 107, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$Who can see my pay information — can my colleagues see what I earn?$$, $$No — your pay information is strictly private. Only you and authorised HR or payroll staff can see your payslips and salary details. InflowHR uses role-based access controls, which means people only see the data their role requires. Your colleagues can see your name and role in the directory, but nothing sensitive.$$, $$pay salary visible private confidential who can see colleagues privacy RLS$$, 108, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$I have updated my address but I am not sure it saved — how do I check?$$, $$Go to your Profile page and check the details there — if the change saved successfully you will see the updated information displayed. If it still shows the old address, try again and make sure you tap Save after editing. Some fields may need your HR admin to update on your behalf.$$, $$address update saved profile change details not working check$$, 109, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$I am leaving the company — what happens to my data after I go?$$, $$When you are offboarded, your access is removed and your account is frozen. Your employer retains your records for the period required by law and company policy. After that retention period, your data is automatically and permanently deleted. You can request a copy of your data before you leave by using the Download My Data button on your Profile page.$$, $$leaving leavers data deleted retention offboarding GDPR privacy account frozen$$, 110, NULL);
