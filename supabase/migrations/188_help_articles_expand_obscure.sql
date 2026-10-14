-- Migration: 188_help_articles_expand_obscure
-- Description: Add FAQ articles for common but obscure workplace questions
--              covering WFH equipment, career progression, pets, referrals, etc.

-- =============================================================================
-- GENERAL — additional articles (sort_order 20+)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$Can I bring my dog to work?$$, $$Pets in the workplace are subject to your company policy. Some offices allow well-behaved dogs on certain days or in designated areas, while others do not permit animals. Check your employee handbook or ask HR for your company's specific pet policy.$$, $$dog pet animal office bring work canine puppy$$, 20, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I refer a friend for a job?$$, $$If your company has an employee referral scheme, you can usually submit referrals through HR or via the internal recruitment system. Include the candidate's name, contact details, and the role you are recommending them for. Many companies offer a referral bonus if the candidate is hired and passes their probation period.$$, $$refer referral friend recruit recommendation bonus hire job vacancy$$, 21, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I get promoted?$$, $$Career progression typically involves demonstrating strong performance in your current role, taking on additional responsibilities, and discussing your goals with your manager during performance reviews or 1-2-1 meetings. Ask your manager about the criteria for the next level and what development is needed. Many companies have a formal promotion process tied to review cycles.$$, $$promoted promotion career progression advance level up pay rise$$, 22, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$Can I work from another country?$$, $$Working from abroad involves tax, visa, and employment law considerations that vary by country. Most companies require prior approval before you work from a different country. Check with HR about your company's international remote working policy, including any limits on the number of days allowed.$$, $$abroad overseas remote international travel work from another country workcation$$, 23, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What is the employee assistance programme (EAP)?$$, $$An EAP provides free, confidential support for employees dealing with personal or work-related issues such as stress, anxiety, financial concerns, or relationship difficulties. Services typically include phone counselling, online resources, and sometimes face-to-face sessions. Contact HR for your EAP provider details and access information.$$, $$EAP employee assistance programme counselling mental health wellbeing support stress anxiety$$, 24, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I report a near miss or safety concern?$$, $$Report any near miss or safety concern to your manager or health and safety representative immediately. Most companies have an incident reporting form or system. Do not wait — early reporting prevents future accidents. You will not be penalised for raising genuine safety concerns.$$, $$near miss safety hazard incident accident report concern dangerous$$, 25, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$Can I do voluntary work during work hours?$$, $$Some companies offer paid volunteering days or allow time off for charitable activities. Check your employee handbook or speak to HR about your company's volunteering policy. You may need manager approval in advance.$$, $$volunteering charity community service time off volunteer$$, 26, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I request a pay rise?$$, $$Prepare by gathering evidence of your performance, additional responsibilities, and any market data for your role. Schedule a conversation with your manager, ideally around performance review time. Present your case professionally and be open to discussing a timeline if an immediate rise is not possible.$$, $$pay rise salary increase raise negotiate more money wage$$, 27, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What is the whistleblowing policy?$$, $$Whistleblowing is reporting serious wrongdoing such as fraud, criminal activity, or health and safety dangers. UK law protects whistleblowers from unfair treatment. You can report concerns to your manager, HR, or a designated whistleblowing officer. Anonymous reporting channels may be available.$$, $$whistleblowing report fraud concern wrongdoing protected disclosure$$, 28, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$Can I have a second job?$$, $$Having a second job is generally permitted unless your contract contains a restrictive clause. You must ensure the second job does not conflict with your primary role, affect your performance, or breach any confidentiality obligations. Check your employment contract and inform your manager or HR.$$, $$second job moonlighting side hustle additional employment outside work$$, 29, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I change my working hours?$$, $$Submit a formal flexible working request to your manager in writing. Include the change you want, when you would like it to start, and how any impact on the business could be managed. Your employer must consider the request and respond within two months.$$, $$change hours working pattern part time flexible reduce increase$$, 30, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What happens if I lose my work ID badge or pass?$$, $$Report a lost ID badge or access pass to your facilities team or HR immediately for security reasons. A replacement will be arranged, though there may be a small charge. You may be given temporary access while awaiting your new badge.$$, $$lost ID badge pass access card replacement security$$, 31, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$Can I take time off for jury service?$$, $$You are legally entitled to time off for jury service in the UK. Your employer cannot refuse to let you attend. Some employers pay your full salary during jury service, others expect you to claim the loss of earnings allowance from the court. Check your contract or ask HR.$$, $$jury service duty court time off legal obligation$$, 32, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I arrange a workplace adjustment or reasonable adjustment?$$, $$If you have a disability or health condition that affects your ability to work, speak to your manager or HR about reasonable adjustments. These could include modified equipment, flexible hours, or changes to your workspace. Your employer is legally required to consider reasonable adjustments under the Equality Act 2010.$$, $$reasonable adjustment disability access needs equipment support workplace modification$$, 33, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What is the probation period and what does it mean?$$, $$A probation period is an initial period of employment, typically 3 to 6 months, during which your performance and suitability are assessed. During probation, notice periods are usually shorter. Your manager should provide regular feedback and a formal review before the probation ends.$$, $$probation period trial new starter assessment review pass fail$$, 34, NULL);

-- =============================================================================
-- POLICIES — additional articles (sort_order 20+)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What equipment can I get for working from home?$$, $$Your employer may provide or reimburse essential home working equipment such as a monitor, keyboard, mouse, headset, or desk chair. A DSE (display screen equipment) assessment may be required. Check with your manager or IT department about what is available and the process for requesting equipment.$$, $$work from home equipment WFH monitor chair desk keyboard mouse DSE remote setup$$, 20, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$Can I claim home working expenses?$$, $$If you work from home regularly, you may be able to claim tax relief on additional household costs such as heating and electricity. HMRC allows a flat rate of £6 per week without evidence. Some employers provide a home working allowance. Check with HR or your payroll team.$$, $$home working expenses allowance claim HMRC tax relief bills utilities WFH$$, 21, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the office parking policy?$$, $$Office parking is usually allocated by your facilities team based on availability, role, or seniority. Some offices have limited spaces and operate a booking system or waiting list. Speak to your office manager or check the company intranet for details.$$, $$parking car space office permit allocated lot$$, 22, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$Can I use personal devices for work?$$, $$BYOD (bring your own device) policies vary by company. Some allow personal devices with approved security software, while others restrict work to company-issued devices only. Check your IT or information security policy before accessing work systems on personal devices.$$, $$BYOD personal device phone laptop tablet own device work$$, 23, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the gift and hospitality policy?$$, $$Most companies have rules about accepting gifts from clients, suppliers, or business contacts. Small gifts of nominal value are usually acceptable, but anything above a set threshold must be declared to your manager or compliance team. Never accept cash. Check your employee handbook for specific limits.$$, $$gift hospitality bribery accepting presents clients suppliers declare$$, 24, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the cycle to work scheme?$$, $$The cycle to work scheme lets you hire a bicycle and safety equipment through salary sacrifice, saving on tax and National Insurance. Your employer handles the arrangement with a provider. Speak to HR or payroll about joining the scheme and available providers.$$, $$cycle to work bike scheme salary sacrifice bicycle commute green$$, 25, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the eye test and glasses policy?$$, $$If you use a computer screen regularly at work, your employer must provide an eye test on request and contribute towards glasses if they are specifically needed for screen work. Contact HR to arrange an eye test voucher.$$, $$eye test glasses spectacles screen VDU DSE vision optician$$, 26, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the travel and subsistence policy?$$, $$Business travel expenses such as train tickets, mileage, hotels, and meals can usually be claimed back through the expenses system. Keep all receipts and submit claims promptly. Pre-approval may be required for overnight stays or flights. Check the expenses policy for per-diem rates and limits.$$, $$travel expenses mileage hotel train subsistence business trip claim$$, 27, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the mobile phone policy?$$, $$Personal mobile phone use during work should be limited to breaks unless an emergency. Some companies issue work phones with specific usage guidelines. Check your company policy about phone use during meetings and in customer-facing roles.$$, $$mobile phone personal use work calls texting device$$, 28, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the smoking and vaping policy?$$, $$Smoking and vaping are prohibited in enclosed workplaces and most company premises. Designated smoking areas may be available outside. Smoke breaks should be taken during your normal break times. Some companies offer support for employees who wish to stop smoking.$$, $$smoking vaping cigarette e-cigarette break area prohibited$$, 29, NULL);

-- =============================================================================
-- LEAVE — additional articles (sort_order 20+)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$Can I take a mental health day?$$, $$Mental health is treated as seriously as physical health. If you need time off for mental health reasons, you can request sick leave in the usual way. Some companies also offer wellbeing days as an additional benefit. Speak to your manager or HR if you need ongoing support.$$, $$mental health day wellbeing stress burnout anxiety time off sick$$, 20, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$Can I take time off for a medical appointment?$$, $$Your employer is not legally required to give you paid time off for routine medical appointments, but many companies allow reasonable time for GP, dental, or hospital visits. Try to book appointments outside work hours where possible, and give your manager as much notice as you can.$$, $$medical appointment GP doctor dentist hospital time off$$, 21, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$What is adoption leave?$$, $$Adoption leave is available to employees who are newly matched with a child for adoption. You are entitled to up to 52 weeks of adoption leave. Statutory Adoption Pay is paid for up to 39 weeks. You must give your employer at least 28 days notice before the leave starts.$$, $$adoption leave child adopt SAP statutory matched$$, 22, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$Can I take time off for religious holidays?$$, $$You may be able to use annual leave for religious holidays not included in your company's bank holiday calendar. Some employers allow flexible swapping of bank holidays. Speak to your manager or HR in advance to make arrangements.$$, $$religious holiday festival faith Eid Diwali Hanukkah Christmas observance$$, 23, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$Can I take emergency time off for dependants?$$, $$You have a statutory right to take reasonable unpaid time off to deal with an emergency involving a dependant, such as a child, spouse, or elderly parent. This covers unexpected situations like illness, injury, or school closure. Inform your manager as soon as possible.$$, $$emergency dependant child parent carer family time off urgent$$, 24, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$Can I take time off to move house?$$, $$There is no statutory right to time off for moving house, but some employers allow one or two days as a discretionary benefit. Check your company policy or speak to your manager. You may need to use annual leave if moving leave is not available.$$, $$moving house relocation day off move home$$, 25, NULL);

-- =============================================================================
-- PAY — additional articles (sort_order 20+)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What is a student loan deduction?$$, $$If you have an outstanding student loan and earn above the repayment threshold, your employer deducts repayments directly from your salary. The amount depends on your plan type and earnings. Deductions are shown on your payslip. Contact the Student Loans Company for balance queries.$$, $$student loan repayment deduction plan 1 2 threshold SLC$$, 20, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What are childcare vouchers and tax-free childcare?$$, $$The childcare vouchers scheme is closed to new entrants but existing members can continue. Tax-Free Childcare is the current government scheme, providing up to £2,000 per child per year towards approved childcare costs. Apply through the gov.uk childcare account.$$, $$childcare vouchers tax free nursery child care kids$$, 21, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$How do I opt out of the pension scheme?$$, $$You can opt out of your workplace pension within one month of being enrolled to receive a full refund of contributions. After that, you can still stop contributing but previous contributions are not refunded. Contact your payroll or pension provider. Note that your employer will re-enrol you every three years.$$, $$pension opt out stop contributing auto enrolment refund$$, 22, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What is a bonus and when is it paid?$$, $$Bonus payments depend on your company's bonus scheme, which may be based on individual performance, team targets, or company profits. Bonus timing and eligibility criteria are set out in your contract or bonus scheme documentation. Bonuses are subject to tax and NI deductions.$$, $$bonus payment performance annual discretionary incentive reward$$, 23, NULL);

-- =============================================================================
-- BENEFITS — additional articles (sort_order 15+)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What is private medical insurance?$$, $$Some employers offer private medical insurance (PMI) as a benefit. It can provide faster access to consultants, diagnostics, and treatment. Check your benefits package for details on coverage, dependants, and any excess you need to pay.$$, $$private medical insurance PMI health BUPA AXA Vitality coverage$$, 15, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What is death in service benefit?$$, $$Death in service benefit pays a lump sum to your nominated beneficiaries if you pass away during employment. The payout is typically 2 to 4 times your annual salary. Ensure your nomination form is up to date by checking with HR.$$, $$death in service life insurance benefit lump sum beneficiary nomination$$, 16, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What is income protection insurance?$$, $$Income protection provides a percentage of your salary if you are unable to work due to long-term illness or injury. It typically pays out after a waiting period, such as 13 or 26 weeks. Check your benefits package for coverage details.$$, $$income protection insurance long term sick disability salary replacement$$, 17, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What employee discounts are available?$$, $$Many companies offer employee discount programmes through platforms like Perkbox, Reward Gateway, or similar. These can include discounts on retail, dining, cinema, gym memberships, and more. Check with HR or your benefits platform for what is available.$$, $$discounts perks offers retail gym shopping employee benefit platform$$, 18, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What is the season ticket loan?$$, $$A season ticket loan is an interest-free loan from your employer to buy an annual travel season ticket. You repay it through monthly salary deductions. This can save you money compared to buying monthly tickets. Speak to HR about applying.$$, $$season ticket loan travel commute train bus annual interest free$$, 19, NULL);

-- =============================================================================
-- PERFORMANCE — additional articles (sort_order 10+)
-- =============================================================================

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How do I prepare for my performance review?$$, $$Review your objectives and gather evidence of your achievements since the last review. Note any challenges, skills developed, and training completed. Think about your career goals and what support you need. Come with specific examples and be ready to discuss development areas honestly.$$, $$performance review prepare appraisal annual assessment objectives evidence$$, 10, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How do I request training or a course?$$, $$Discuss your training needs with your manager during your 1-2-1 or performance review. If your company has a learning and development budget, your manager can submit a request on your behalf. You can also browse available courses in the Training section of the app.$$, $$training course learning development request study CPD upskill$$, 11, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$What is a personal development plan (PDP)?$$, $$A PDP is a document outlining your development goals, the skills you want to build, and the steps to get there. It is usually agreed with your manager during performance reviews and reviewed regularly. It helps structure your career progression and identify training needs.$$, $$PDP personal development plan goals career growth objectives$$, 12, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$Can I request a mentor?$$, $$Many companies have mentoring programmes where experienced colleagues guide employees on career development. Ask your manager or HR about available mentoring opportunities. You can also informally approach a senior colleague you respect and ask if they would be willing to mentor you.$$, $$mentor mentoring coaching guidance career senior colleague advice$$, 13, NULL);
