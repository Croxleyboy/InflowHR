-- Migration: 184_employee_help
-- Description: Create employee help FAQ system with full-text search and seed global articles

-- =============================================================================
-- 1. CREATE TABLE
-- =============================================================================

CREATE TABLE help_articles (
  id SERIAL PRIMARY KEY,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  data_query TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', question || ' ' || answer || ' ' || keywords)
  ) STORED
);

CREATE INDEX idx_help_articles_search ON help_articles USING gin(search_vector);
CREATE INDEX idx_help_articles_company ON help_articles(company_id);

-- =============================================================================
-- 2. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE help_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY help_articles_select ON help_articles FOR SELECT
  USING (company_id IS NULL OR company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY help_articles_insert ON help_articles FOR INSERT
  WITH CHECK (company_id = get_my_company_id() AND is_company_admin());

CREATE POLICY help_articles_update ON help_articles FOR UPDATE
  USING (company_id = get_my_company_id() AND is_company_admin())
  WITH CHECK (company_id = get_my_company_id() AND is_company_admin());

CREATE POLICY help_articles_delete ON help_articles FOR DELETE
  USING (company_id = get_my_company_id() AND is_company_admin());

-- =============================================================================
-- 3. SEED GLOBAL FAQ ARTICLES (company_id IS NULL)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- LEAVE (sort_order 1-15)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$How much annual leave do I have left?$$, $$You currently have {{leave_balance}} remaining. You can view your full leave balance breakdown in the Leave section from the sidebar.$$, $$holiday vacation days off allowance remaining balance$$, 1, $$leave_balance$$);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$How do I request time off?$$, $$Go to the sidebar and select Leave, then click New Request. Choose the type of leave, select your dates, and add any notes before submitting for approval.$$, $$book holiday request absence vacation$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$What are my upcoming leave requests?$$, $$Your upcoming leave requests are: {{leave_requests}}. You can view and manage all your requests in the Leave section.$$, $$holiday booked upcoming scheduled vacation$$, 3, $$leave_requests$$);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$What is the sick leave policy?$$, $$If you are unwell, notify your manager as soon as possible before your shift starts. You may need to provide a fit note from your GP for absences longer than 7 days. Statutory Sick Pay (SSP) may apply after the waiting period.$$, $$illness unwell absent sick day GP doctor$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$How do I cancel a leave request?$$, $$Go to the Leave section from the sidebar, find the pending request you want to cancel, and click Cancel. You can only cancel requests that have not yet been approved or that are still in the future.$$, $$withdraw remove delete holiday$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$What is maternity leave entitlement?$$, $$UK statutory maternity leave is up to 52 weeks: 26 weeks ordinary and 26 weeks additional. Statutory Maternity Pay is paid for up to 39 weeks. You must give at least 15 weeks notice before your due date.$$, $$pregnant pregnancy baby birth mother SMP$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$What is paternity leave entitlement?$$, $$UK statutory paternity leave is either 1 or 2 consecutive weeks, taken within 56 days of the birth or adoption. You must give at least 15 weeks notice. Statutory Paternity Pay applies if you are eligible.$$, $$father baby birth dad SPP$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$What is shared parental leave?$$, $$Shared Parental Leave allows eligible parents to share up to 50 weeks of leave and up to 37 weeks of pay between them. It provides flexibility in how you share caring responsibilities in the first year.$$, $$SPL parent baby shared caring$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$Can I carry over unused annual leave?$$, $$Carry-over of unused annual leave depends on your company policy. Some organisations allow a limited number of days to be carried into the next holiday year. Check with your HR department for specific rules.$$, $$rollover unused holiday remaining$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$What is compassionate leave?$$, $$Compassionate leave is paid time off granted following a bereavement or serious family emergency. The amount of leave varies by company policy. Speak to your manager or HR as soon as you are able.$$, $$bereavement death family funeral emergency$$, 10, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$How do I request a half day?$$, $$When creating a new leave request, select the half-day option and choose either morning or afternoon. This will deduct 0.5 days from your leave balance.$$, $$half day morning afternoon partial$$, 11, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$What is TOIL (Time Off In Lieu)?$$, $$TOIL is time off earned by working extra hours beyond your contracted hours. Instead of overtime pay, you take equivalent time off at a later date. Your manager must approve both the extra hours and the TOIL request.$$, $$time off in lieu overtime extra hours$$, 12, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$How far in advance should I book annual leave?$$, $$You should book annual leave as early as possible, ideally at least 2 weeks in advance. Popular periods such as school holidays and Christmas may require earlier booking. Your manager needs time to ensure adequate cover.$$, $$advance notice booking holiday planning$$, 13, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$What happens to my leave if I am on long-term sick?$$, $$Your annual leave continues to accrue during long-term sickness absence. You are entitled to take your statutory holiday even if you have been off sick. Speak to HR about how to manage your leave balance.$$, $$long term sick accrual absence illness$$, 14, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$leave$$, $$Can I take unpaid leave?$$, $$Unpaid leave may be available at your manager and HR discretion. It is not a statutory right in most cases. Discuss your circumstances with your manager and submit a request if approved.$$, $$unpaid absence time off no pay$$, 15, NULL);

-- -----------------------------------------------------------------------------
-- PAY (sort_order 1-15)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$When was my last payslip?$$, $$Your most recent payslip: {{last_payslip}}. You can view all your payslips in the Payslips section from the sidebar.$$, $$pay salary wage slip paycheck$$, 1, $$last_payslip$$);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$When do I get paid?$$, $$Payment dates vary by company. Check your most recent payslip for your payment schedule or contact your payroll department. Most companies pay monthly on a fixed date.$$, $$payday salary when payment date$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What deductions are on my payslip?$$, $$Common deductions include Income Tax (PAYE), National Insurance contributions, workplace pension contributions, and any student loan repayments. You may also see deductions for salary sacrifice schemes or union membership.$$, $$tax NI pension deduction taken off$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What is my tax code and what does it mean?$$, $$Your tax code is shown on your payslip and tells your employer how much tax-free income you are entitled to. A common code is 1257L. If you believe your tax code is wrong, contact HMRC directly.$$, $$tax code PAYE HMRC 1257L allowance$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$How is my National Insurance calculated?$$, $$National Insurance is calculated as a percentage of your earnings above a threshold. The rates and thresholds are set by HMRC and may change each tax year. Your payslip shows the NI amount deducted each period.$$, $$NI national insurance contributions class 1$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What is my pension contribution?$$, $$Your pension contribution details are shown on your payslip and in the Benefits section. The minimum employee contribution under auto-enrolment is 5% of qualifying earnings. Your employer contributes at least 3%.$$, $$pension contribution auto enrolment retirement$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$How do I update my bank details?$$, $$To update your bank details, contact your HR or payroll department directly. For security reasons, do not send bank details via email. Changes may take one payroll cycle to take effect.$$, $$bank account sort code payment details$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What is a P45?$$, $$A P45 is a document given to you when you leave employment. It shows your total pay and tax for the current tax year. You should give it to your new employer so they can apply the correct tax code.$$, $$P45 leaving employment tax new job$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What is a P60?$$, $$A P60 is an annual summary of your pay and tax deductions for the tax year. Your employer must issue it by 31 May each year. Keep it safe as you may need it for tax returns or mortgage applications.$$, $$P60 annual tax summary year end$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$How do I claim overtime?$$, $$Record your overtime hours on your timesheet and ensure your manager approves them before the payroll cut-off date. Overtime rates and eligibility depend on your contract and company policy.$$, $$overtime extra hours additional pay claim$$, 10, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What is the National Living Wage?$$, $$The National Living Wage is the minimum hourly rate set by the UK government for workers aged 21 and over. Rates are updated annually each April. Check gov.uk for the current rate.$$, $$minimum wage NLW NMW hourly rate$$, 11, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$How do I view my payslips?$$, $$Go to Payslips from the sidebar menu. You can view, download, and print your current and historical payslips. If a payslip is missing, contact your payroll department.$$, $$view payslip download print history$$, 12, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$What is salary sacrifice?$$, $$Salary sacrifice is a voluntary agreement to reduce your gross salary in exchange for a non-cash benefit, such as additional pension contributions, cycle-to-work, or childcare. It can reduce your tax and NI liability.$$, $$salary sacrifice exchange benefit reduce$$, 13, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$When is the payroll cut-off date?$$, $$The payroll cut-off date is the deadline for submitting timesheets, expenses, and changes before they are processed in the next pay run. Check with your payroll department for the exact date each month.$$, $$cut-off deadline payroll submission$$, 14, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$pay$$, $$How do I query a payslip error?$$, $$If you notice an error on your payslip, contact your HR or payroll team immediately with details of the discrepancy. Keep a copy of the affected payslip for reference. Corrections are usually applied in the next pay run.$$, $$error mistake incorrect payslip query dispute$$, 15, NULL);

-- -----------------------------------------------------------------------------
-- SHIFTS (sort_order 1-12)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$When is my next shift?$$, $$Your next scheduled shift: {{next_shift}}. You can view your full rota in the Shifts section from the sidebar.$$, $$rota schedule roster work next shift$$, 1, $$next_shift$$);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How many hours have I worked this week?$$, $$You have worked {{hours_worked}} so far this week. Check your Timesheets section for a full breakdown of your hours.$$, $$hours worked week total time logged$$, 2, $$hours_worked$$);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How do I request a shift swap?$$, $$Go to Shift Swap from the sidebar, select the shift you want to swap, and choose an available colleague. Both parties and your manager must approve the swap before it is confirmed.$$, $$swap shift exchange trade colleague$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How do I submit my timesheet?$$, $$Go to Timesheets from the sidebar, fill in your hours for each day, and click Submit for approval. Ensure you submit before the payroll cut-off date to avoid delays in your pay.$$, $$timesheet hours submit record log$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$What happens if I am late for a shift?$$, $$Notify your manager as soon as possible if you are going to be late. Repeated lateness may be addressed through the company attendance policy. Your actual start time should be recorded accurately.$$, $$late tardy delayed arrival shift$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How do I report an absence?$$, $$Contact your manager before your shift starts to report your absence. Follow your company absence reporting procedure. You may need to provide a reason and expected return date.$$, $$absence report notify call in sick$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$What is the notice period for shift changes?$$, $$Your company should give you reasonable notice of any changes to your shift pattern. Check your contract for specific terms. If you have concerns about short-notice changes, speak to your manager or HR.$$, $$notice shift change rota amendment$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$Can I pick up extra shifts?$$, $$Check the available shifts board or speak to your manager about picking up additional shifts. Extra shifts are subject to working time regulations and your contracted hours.$$, $$extra shift overtime additional pick up$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How do I check in for my shift?$$, $$Use the Check-In feature from your dashboard when you arrive for your shift. This records your attendance and start time. If you have trouble checking in, notify your manager.$$, $$check in clock in attendance arrive start$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$What are my contracted hours?$$, $$Your contracted hours are set out in your employment contract. You can also check your profile in the system. If you believe your contracted hours are incorrect, contact HR.$$, $$contracted hours weekly full time part time$$, 10, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$How do I correct a timesheet error?$$, $$Submit a time correction request through the Timesheets section. Provide the correct details and a brief explanation. Your manager will need to approve the amendment.$$, $$timesheet error correction amend fix$$, 11, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$shifts$$, $$What is the break policy for my shift?$$, $$Under UK law, you are entitled to a 20-minute uninterrupted rest break if you work more than 6 hours. Your company may offer longer breaks. Check your contract or staff handbook for details.$$, $$break rest lunch pause 20 minutes$$, 12, NULL);

-- -----------------------------------------------------------------------------
-- BENEFITS (sort_order 1-10)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What benefits are available to me?$$, $$Check the Benefits section in the sidebar to view all benefits available to you. These may include pension, healthcare, cycle-to-work, and other schemes offered by your company.$$, $$benefits perks available schemes employee$$, 1, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$How do I enrol in the pension scheme?$$, $$You are automatically enrolled into the workplace pension scheme if you meet the eligibility criteria. Check the Benefits section for your enrolment status. Contact HR if you have questions.$$, $$pension enrol auto enrolment workplace$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What is the company pension contribution?$$, $$The minimum employer pension contribution under auto-enrolment is 3% of qualifying earnings. Your company may offer a higher rate. Check the Benefits section or your pension statement for details.$$, $$pension employer contribution percentage rate$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$How does the cycle-to-work scheme work?$$, $$The cycle-to-work scheme lets you hire a bicycle and safety equipment through salary sacrifice, saving on tax and National Insurance. Speak to HR to check if your company participates and how to apply.$$, $$cycle to work bike bicycle scheme salary sacrifice$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What healthcare benefits are offered?$$, $$Healthcare benefits vary by company and may include private medical insurance, dental cover, or health cash plans. Check the Benefits section in the sidebar for what is available to you.$$, $$healthcare medical insurance dental health cover$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$How do I opt out of the pension?$$, $$You can opt out of the workplace pension by contacting your pension provider or HR. Be aware that opting out means you will lose your employer contributions. You will be re-enrolled every 3 years automatically.$$, $$pension opt out leave stop contributions$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What is an Employee Assistance Programme?$$, $$An EAP is a confidential service offering counselling, support, and advice on work or personal issues. It is usually free for employees and their families. Check with HR for your provider details.$$, $$EAP assistance programme counselling support wellbeing$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$Are there childcare vouchers or support?$$, $$Childcare support varies by company. The government Tax-Free Childcare scheme may be available. Check with HR for any company-specific childcare benefits or salary sacrifice schemes.$$, $$childcare vouchers nursery kids children support$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$What eye care benefits are available?$$, $$Employers must provide eye tests for employees who use display screen equipment (DSE) regularly. Some companies also contribute towards the cost of corrective glasses if needed for DSE work.$$, $$eye care test glasses DSE display screen$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$benefits$$, $$How do I claim a benefit?$$, $$Go to the Benefits section from the sidebar and follow the enrolment steps for the benefit you wish to claim. Some benefits may require approval from HR or have specific enrolment windows.$$, $$claim benefit enrol apply sign up$$, 10, NULL);

-- -----------------------------------------------------------------------------
-- GENERAL (sort_order 1-12)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$Who is my manager?$$, $$Your current line manager is {{manager_name}}. If you need to contact them, you can find their details in the Directory or on your profile page.$$, $$supervisor line manager boss reporting to$$, 1, $$my_manager$$);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What department am I in?$$, $$You are in the {{department}} department. You can view your department details and colleagues in the Directory section.$$, $$department team division group section$$, 2, $$my_department$$);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I update my personal details?$$, $$Go to Profile from the sidebar to update your personal information such as address, phone number, and emergency contacts. Some changes may require HR approval.$$, $$profile personal details update change address phone$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$Where can I find company policies?$$, $$Company policies are available in the company handbook or documents section. You can also ask your HR department for specific policies. Key policies are usually shared during onboarding.$$, $$policies handbook documents rules guidelines$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I raise a grievance?$$, $$Follow your company grievance procedure, which usually starts with raising the matter informally with your manager. If unresolved, submit a formal written grievance to HR. You have the right to be accompanied at any hearing.$$, $$grievance complaint issue raise formal$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What is the disciplinary process?$$, $$The typical disciplinary process follows: verbal warning, written warning, final written warning, and dismissal. You have the right to be accompanied at disciplinary hearings. The process is set out in your company handbook.$$, $$disciplinary warning process dismissal misconduct$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I request flexible working?$$, $$Submit a formal flexible working request to your manager in writing. All employees with 26 weeks of service have the statutory right to request flexible working. Your employer must consider the request reasonably.$$, $$flexible working hours remote hybrid request$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What are my GDPR rights as an employee?$$, $$Under GDPR, you have the right to access your personal data, request corrections, and in some cases request deletion. Your employer must tell you what data they hold and why. Contact your Data Protection Officer for requests.$$, $$GDPR data protection privacy rights access$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I contact HR?$$, $$You can contact HR using the internal notification system or by emailing the HR department directly. Check the Directory for HR team contact details. For urgent matters, speak to your line manager first.$$, $$contact HR human resources email phone$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What is the company notice period?$$, $$Your notice period is set out in your employment contract. Statutory minimum is one week per year of service, up to 12 weeks. Check your contract for your specific terms.$$, $$notice period resign leaving contract$$, 10, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$How do I give feedback or raise a suggestion?$$, $$Use the Surveys feature from the sidebar to submit feedback or suggestions. You can also speak to your manager during your 1-2-1 meeting. Many companies also have anonymous feedback channels.$$, $$feedback suggestion idea improvement comment$$, 11, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$general$$, $$What is the employee directory?$$, $$The Directory is available from the sidebar and lets you search for colleagues by name, department, or role. You can find contact details and organisational structure information.$$, $$directory people search colleagues staff find$$, 12, NULL);

-- -----------------------------------------------------------------------------
-- ONBOARDING (sort_order 1-8)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$onboarding$$, $$What should I expect on my first day?$$, $$Your first day typically includes a welcome meeting, IT setup, a tour of the workplace, and introductions to your team. Check your onboarding tasks on the dashboard for a full list of what to complete.$$, $$first day induction welcome new starter$$, 1, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$onboarding$$, $$What is the probation period?$$, $$The probation period is typically 3 to 6 months, as set out in your contract. During this time, your performance is reviewed and additional support is provided. Successful completion leads to confirmation of your role.$$, $$probation trial period review new starter$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$onboarding$$, $$How do I complete my onboarding tasks?$$, $$Check your dashboard for any pending onboarding items. These may include completing your profile, reading policies, signing documents, and finishing mandatory training. Tick off each task as you complete it.$$, $$onboarding tasks checklist complete pending$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$onboarding$$, $$Where do I find the employee handbook?$$, $$The employee handbook is available in the company documents section or can be requested from HR. It contains key policies, procedures, and information about your employment.$$, $$handbook guide manual company policies document$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$onboarding$$, $$How do I set up my profile?$$, $$Go to Profile from the sidebar and complete your personal details including contact information, emergency contacts, and any other required fields. A complete profile helps HR and your team.$$, $$profile setup complete fill in details$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$onboarding$$, $$Who do I contact if I have IT issues?$$, $$Contact your IT helpdesk or speak to your manager if you experience technical problems. Details for IT support are usually provided during your induction or in the employee handbook.$$, $$IT issues technical support helpdesk computer$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$onboarding$$, $$What training do I need to complete?$$, $$Check the E-Learning section from the sidebar for any assigned training courses. Mandatory training such as health and safety or data protection should be completed during your first week.$$, $$training courses mandatory e-learning induction$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$onboarding$$, $$How do I get my staff ID or access badge?$$, $$Your staff ID or access badge is usually arranged by HR or facilities during your onboarding. If you have not received one, contact your manager or HR to arrange it.$$, $$staff ID badge access card pass$$, 8, NULL);

-- -----------------------------------------------------------------------------
-- PERFORMANCE (sort_order 1-8)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$When is my next performance review?$$, $$Performance reviews are typically held annually or bi-annually. Check with your manager for your specific review date. You can prepare by reviewing your objectives and gathering evidence of your achievements.$$, $$review appraisal annual assessment date$$, 1, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How do I set my objectives?$$, $$Discuss and agree your objectives with your manager during your 1-2-1 or performance review meeting. Objectives should be specific, measurable, and aligned with team and company goals.$$, $$objectives goals targets set KPIs OKRs$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$What is a 1-2-1 meeting?$$, $$A 1-2-1 (one-to-one) is a regular private meeting between you and your manager. It is an opportunity to discuss progress, raise concerns, get feedback, and plan your development.$$, $$one to one 121 meeting manager catch up$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How do I prepare for my performance review?$$, $$Review your objectives from the start of the period and gather evidence of your achievements. Note any challenges and how you overcame them. Prepare questions and any development requests you want to discuss.$$, $$prepare review appraisal evidence achievements$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How do I give kudos to a colleague?$$, $$Go to the Kudos section from the sidebar and send a recognition message to a colleague. Choose a category and write a brief note about what they did well. Kudos are visible to their manager.$$, $$kudos recognition praise thank colleague$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$What is a personal development plan?$$, $$A PDP is a document that outlines your career goals and the actions you will take to develop your skills. It is usually created with your manager and reviewed during performance meetings.$$, $$PDP development plan career growth learning$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How do I request training or development?$$, $$Discuss your training needs with your manager during your 1-2-1 meeting. Check the E-Learning section for available courses. Your company may have a training budget or approval process for external courses.$$, $$training development course learning request budget$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$performance$$, $$How are pay rises decided?$$, $$Pay rises are typically based on individual performance, company budget, and market rates. Decisions are usually made during the annual pay review cycle. Speak to your manager if you have questions about your pay.$$, $$pay rise salary increase increment review$$, 8, NULL);

-- -----------------------------------------------------------------------------
-- POLICIES (sort_order 1-10)
-- -----------------------------------------------------------------------------

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the dress code?$$, $$The dress code depends on your company and role. Check your employee handbook or ask your manager for guidance. Some workplaces have casual dress, while others require business or safety attire.$$, $$dress code clothing uniform attire what to wear$$, 1, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$How do I submit an expense claim?$$, $$Go to Expenses from the sidebar, click New Claim, upload your receipt, fill in the details, and submit for approval. Keep original receipts and submit claims promptly. Your manager must approve before payment.$$, $$expense claim receipt reimbursement submit$$, 2, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the work from home policy?$$, $$Working from home arrangements vary by company and role. Check with your manager or the company handbook for your specific policy. You may need to submit a formal flexible working request.$$, $$work from home remote WFH hybrid policy$$, 3, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the social media policy?$$, $$Be professional on social media and do not share confidential company information. Avoid posting content that could damage the company reputation. Check your handbook for the full social media policy.$$, $$social media policy online posting facebook twitter$$, 4, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the anti-bullying and harassment policy?$$, $$The company operates a zero-tolerance policy on bullying and harassment. If you experience or witness bullying or harassment, report it to your manager or HR immediately. All reports are taken seriously and investigated.$$, $$bullying harassment zero tolerance report complaint$$, 5, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the alcohol and drugs policy?$$, $$Being under the influence of alcohol or drugs at work is prohibited and may result in disciplinary action. If you have a dependency, confidential support is available through your EAP or HR.$$, $$alcohol drugs substance misuse prohibited policy$$, 6, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What are the health and safety responsibilities?$$, $$All employees must report hazards, follow safety procedures, and use equipment correctly. Your employer is responsible for providing a safe working environment. Mandatory health and safety training is usually required.$$, $$health safety hazard risk report responsibility$$, 7, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the data protection policy?$$, $$Follow GDPR guidelines when handling personal data. Only access data you need for your role, keep it secure, and report any data breaches to your Data Protection Officer immediately.$$, $$data protection GDPR privacy breach security$$, 8, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the equal opportunities policy?$$, $$The company is committed to equal opportunities and fair treatment for all employees regardless of age, disability, gender, race, religion, sexual orientation, or any other protected characteristic.$$, $$equal opportunities diversity inclusion fairness discrimination$$, 9, NULL);

INSERT INTO help_articles (company_id, category, question, answer, keywords, sort_order, data_query) VALUES
(NULL, $$policies$$, $$What is the whistleblowing policy?$$, $$Whistleblowing allows you to report wrongdoing or malpractice confidentially. You are protected from retaliation under UK law. Reports can be made to your manager, HR, or through an anonymous channel if available.$$, $$whistleblowing report wrongdoing confidential protection$$, 10, NULL);
