-- ============================================================================
-- Migration 136: Surveys & Feedback
-- Core feature available to all companies
-- ============================================================================

-- ── 1. Template catalogue (seeded, read-only for companies) ─────────────────

CREATE TABLE survey_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  icon TEXT DEFAULT 'clipboard',
  banner_colour TEXT DEFAULT '#4F46E5',
  questions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE survey_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read templates"
  ON survey_templates FOR SELECT TO authenticated
  USING (true);

-- ── 2. Company surveys (from templates or custom-built) ─────────────────────

CREATE TABLE company_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id UUID REFERENCES survey_templates(id),
  title TEXT NOT NULL,
  description TEXT,
  banner_image_url TEXT,
  banner_colour TEXT DEFAULT '#4F46E5',
  questions JSONB NOT NULL DEFAULT '[]',
  delivery_channels TEXT[] DEFAULT '{pc,mobile}',
  is_custom BOOLEAN DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE company_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company scoped read"
  ON company_surveys FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Admin insert"
  ON company_surveys FOR INSERT TO authenticated
  WITH CHECK ((company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin());

CREATE POLICY "Admin update"
  ON company_surveys FOR UPDATE TO authenticated
  USING ((company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin());

CREATE POLICY "Admin delete"
  ON company_surveys FOR DELETE TO authenticated
  USING ((company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin());

-- ── 3. Deployments (active survey runs, max 3 enforced in app) ──────────────

CREATE TABLE survey_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  survey_id UUID NOT NULL REFERENCES company_surveys(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'all' CHECK (target_type IN ('all','department','tag')),
  target_values TEXT[] DEFAULT '{}',
  total_recipients INT DEFAULT 0,
  total_responses INT DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE survey_deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company scoped read"
  ON survey_deployments FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Admin insert"
  ON survey_deployments FOR INSERT TO authenticated
  WITH CHECK ((company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin());

CREATE POLICY "Admin update"
  ON survey_deployments FOR UPDATE TO authenticated
  USING ((company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin());

CREATE POLICY "Admin delete"
  ON survey_deployments FOR DELETE TO authenticated
  USING ((company_id = get_my_company_id() AND is_company_admin()) OR is_super_admin());

-- ── 4. Responses (one per employee per deployment) ──────────────────────────

CREATE TABLE survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  deployment_id UUID NOT NULL REFERENCES survey_deployments(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  answers JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (deployment_id, employee_id)
);

ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company scoped read"
  ON survey_responses FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "Employee can insert own response"
  ON survey_responses FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "Employee can update own response"
  ON survey_responses FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() AND employee_id::text = auth.uid()::text);

-- ── 5. Seed template catalogue (20 UK HR templates) ─────────────────────────

INSERT INTO survey_templates (title, description, category, icon, banner_colour, questions) VALUES

-- ── Category 1: Onboarding Lifecycle ────────────────────────────────────────

('Day 1 / First Week Check-in', 'Auto-scheduled check-in for new hires at day 7. Ensures workspace, IT and documentation readiness.', 'onboarding', 'user-plus', '#10B981',
 '[
   {"id":"q1","text":"My workspace, IT equipment, and system access logins were fully ready for my first day.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"Have you successfully uploaded your Right to Work documents and completed your HR payroll profile?","type":"radio","options":["Yes","No"],"required":true},
   {"id":"q3","text":"What is one thing that could have made your first week smoother?","type":"text","required":false}
 ]'::jsonb),

('30-Day New Starter Feedback', 'Onboarding feedback from new employees after their first month. Covers role clarity, team welcome and training.', 'onboarding', 'user-plus', '#10B981',
 '[
   {"id":"q1","text":"The role expectations and duties match what was described during recruitment.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"I feel welcomed by my team and well-supported by my direct line manager.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"I have received sufficient initial training to carry out my core day-to-day tasks.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q4","text":"Have you received and reviewed the UK Employee Handbook and company policies?","type":"radio","options":["Yes","No"],"required":true},
   {"id":"q5","text":"Are there any specific tools, resources, or support you still feel you are missing?","type":"text","required":false}
 ]'::jsonb),

('90-Day Probation Review Survey', 'Pre-probation sign-off survey covering goals, culture fit and onboarding quality.', 'onboarding', 'clipboard', '#10B981',
 '[
   {"id":"q1","text":"I feel clear on my personal goals, KPIs, and how my performance is measured.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"The company culture aligns with my initial expectations.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"How would you rate the overall onboarding experience from application to now?","type":"scale","min":1,"max":5,"labels":["Poor","Excellent"],"required":true},
   {"id":"q4","text":"Have you scheduled your formal 3-month probation review meeting with your line manager?","type":"radio","options":["Yes","No"],"required":true},
   {"id":"q5","text":"What suggestions do you have to improve our onboarding process for future hires?","type":"text","required":false}
 ]'::jsonb),

('Induction Training Evaluation', 'Anonymous feedback on formal induction modules. Covers content quality, pace and engagement.', 'onboarding', 'book-open', '#10B981',
 '[
   {"id":"q1","text":"The training content was relevant, clear, and easy to understand.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"The length and pace of the induction program were appropriate.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"How engaging did you find the training overall?","type":"scale","min":1,"max":5,"labels":["Not engaging","Very engaging"],"required":true},
   {"id":"q4","text":"Which induction module was most valuable, and what could be improved?","type":"text","required":false}
 ]'::jsonb),

-- ── Category 2: Exit & Loyalty Benchmarks ───────────────────────────────────

('Exit Interview Questionnaire', 'Structured exit interview to understand why employees leave and gather improvement suggestions.', 'exit', 'log-out', '#EF4444',
 '[
   {"id":"q1","text":"What is your primary reason for leaving the organisation?","type":"radio","options":["Career Progression","Compensation & Benefits","Work-Life Balance","Management","Career Change","Relocation","Personal Reasons"],"required":true},
   {"id":"q2","text":"I felt valued and recognised for the work I contributed.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"My workload was manageable and permitted a healthy work-life balance.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q4","text":"I was satisfied with my pay, pension contributions, and benefits package relative to the UK market.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q5","text":"Would you consider returning to work for this company in the future?","type":"radio","options":["Yes","No"],"required":true},
   {"id":"q6","text":"What could the business have done differently to retain you?","type":"text","required":false}
 ]'::jsonb),

('eNPS Pulse', 'Employee Net Promoter Score — quick anonymous pulse on whether employees would recommend the company.', 'engagement', 'heart', '#6366F1',
 '[
   {"id":"q1","text":"How likely are you to recommend our company as a great place to work to a friend or colleague?","type":"scale","min":0,"max":10,"labels":["Not at all likely","Extremely likely"],"required":true},
   {"id":"q2","text":"What is the primary reason for the score you gave above?","type":"text","required":false}
 ]'::jsonb),

('Offboarding Knowledge Transfer Checklist', 'Final-week checklist for departing employees to ensure proper handover of documentation and assets.', 'exit', 'check-square', '#EF4444',
 '[
   {"id":"q1","text":"Have you documented your key daily/weekly processes for your successor or team?","type":"radio","options":["Yes","No"],"required":true},
   {"id":"q2","text":"Have you transferred ownership of shared cloud files, client accounts, or software admin rights?","type":"radio","options":["Yes","No"],"required":true},
   {"id":"q3","text":"Where is your handover folder or document located?","type":"text","required":true},
   {"id":"q4","text":"Have you arranged the return of company property (laptop, security badge, fuel card) with IT/Operations?","type":"radio","options":["Yes","No"],"required":true}
 ]'::jsonb),

-- ── Category 3: Performance & Growth ────────────────────────────────────────

('Employee Self-Assessment Review', 'Pre-appraisal self-assessment covering achievements, challenges and career development goals.', 'performance', 'trending-up', '#F59E0B',
 '[
   {"id":"q1","text":"What do you consider your top 3 achievements since your last review?","type":"text","required":true},
   {"id":"q2","text":"How effectively were you able to achieve your agreed goals and KPIs over this period?","type":"scale","min":1,"max":5,"labels":["Not at all","Fully achieved"],"required":true},
   {"id":"q3","text":"Which areas of your role did you find most challenging, and why?","type":"text","required":true},
   {"id":"q4","text":"I feel supported by the organisation in my professional growth and skill development.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q5","text":"What specific career goals or training opportunities would you like to focus on next?","type":"text","required":false}
 ]'::jsonb),

('Line Manager Appraisal Review', 'Structured manager evaluation of direct reports covering deliverables, values alignment and development areas.', 'performance', 'star', '#F59E0B',
 '[
   {"id":"q1","text":"The employee consistently meets or exceeds their role deliverables and core targets.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"The employee demonstrates strong alignment with company core values and team culture.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"Highlight key areas where the employee excels.","type":"text","required":true},
   {"id":"q4","text":"Detail any areas requiring improvement or additional managerial support.","type":"text","required":true},
   {"id":"q5","text":"Overall Performance Rating for this period:","type":"radio","options":["Needs Improvement","Meets Expectations","Exceeds Expectations","Outstanding"],"required":true}
 ]'::jsonb),

('Peer / 360° Feedback', 'Anonymous peer review for communication, collaboration and professional strengths.', 'feedback', 'users', '#F59E0B',
 '[
   {"id":"q1","text":"This person communicates clearly, professionally, and in a timely manner.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"This person collaborates effectively and supports team members to solve problems.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"What is this colleague''s greatest strength in working with others?","type":"text","required":false},
   {"id":"q4","text":"What is one area this person could work on to increase their impact?","type":"text","required":false}
 ]'::jsonb),

-- ── Category 4: Health, Wellbeing & Remote Work ─────────────────────────────

('General Employee Wellbeing Check', 'Monthly/bi-monthly anonymous wellbeing pulse covering stress, work-life balance and support needs.', 'wellbeing', 'shield', '#8B5CF6',
 '[
   {"id":"q1","text":"How are you feeling about your current work life overall?","type":"scale","min":1,"max":5,"labels":["Very unhappy","Very happy"],"required":true},
   {"id":"q2","text":"I feel able to manage my current level of workplace stress effectively.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"I can comfortably disconnect from work duties at the end of my working day.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q4","text":"Is there anything the company can do to better support your health and mental wellbeing?","type":"text","required":false}
 ]'::jsonb),

('Workplace Stress & Mental Health Audit', 'Annual anonymous audit to identify workplace pressure points and support awareness.', 'wellbeing', 'alert-triangle', '#8B5CF6',
 '[
   {"id":"q1","text":"My workload expectations are realistic given my contracted hours.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"I know where to access internal mental health resources (e.g. Employee Assistance Programme / Mental Health First Aiders).","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"What is currently your largest source of workplace pressure, if any?","type":"radio","options":["None","Tight Deadlines","Staffing Levels","Unclear Priorities","Client Demands","System Issues"],"required":true},
   {"id":"q4","text":"Do you feel comfortable speaking openly with your line manager if you experience burnout?","type":"radio","options":["Yes","No"],"required":true},
   {"id":"q5","text":"What changes would most improve your daily working environment?","type":"text","required":false}
 ]'::jsonb),

('Remote & Hybrid Work Readiness Assessment', 'DSE and remote work readiness check covering workspace, equipment and connectivity.', 'operations', 'monitor', '#0EA5E9',
 '[
   {"id":"q1","text":"I have a dedicated, safe home workspace suitable for full-day working.","type":"radio","options":["Yes","No"],"required":true},
   {"id":"q2","text":"Have you completed your Display Screen Equipment (DSE) self-assessment for your home setup?","type":"radio","options":["Yes","No"],"required":true},
   {"id":"q3","text":"I have access to reliable internet speed and necessary software to collaborate seamlessly.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q4","text":"I feel well-connected to my core team despite working remotely.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q5","text":"What additional hardware or software tools do you require for your home setup?","type":"text","required":false}
 ]'::jsonb),

('Return-to-Office Feedback', 'Post-policy change feedback on hybrid/office attendance expectations and facilities.', 'operations', 'home', '#0EA5E9',
 '[
   {"id":"q1","text":"The company''s updated hybrid / office attendance expectations are clear and fair.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"The physical office facilities (desks, meeting rooms, technology) support my productive working.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"How many days per week in the office is optimal for your role productivity?","type":"radio","options":["1 Day","2 Days","3 Days","4 Days","5 Days / Full Office"],"required":true},
   {"id":"q4","text":"What improvements to office setup or hot-desking tools would make office days more valuable?","type":"text","required":false}
 ]'::jsonb),

-- ── Category 5: DEI & Workplace Experience ──────────────────────────────────

('DEI Baseline Audit', 'Annual anonymous diversity, equity and inclusion audit. UK GDPR compliant with consent framing.', 'culture', 'globe', '#EC4899',
 '[
   {"id":"q1","text":"People from all backgrounds are treated fairly and with equal opportunity here.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"I feel comfortable expressing my identity and opinions at work without fear of negative impact.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"Company leadership demonstrates a visible commitment to diversity and inclusion.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q4","text":"How would you describe your ethnic background?","type":"radio","options":["White","Mixed / Multiple ethnic groups","Asian / Asian British","Black / African / Caribbean / Black British","Other ethnic group","Prefer not to say"],"required":false},
   {"id":"q5","text":"What additional DEI initiatives or adjustments should the business focus on?","type":"text","required":false}
 ]'::jsonb),

('Inclusion & Psychological Safety Survey', 'Semi-annual culture check measuring psychological safety, risk-taking and inclusion.', 'culture', 'shield', '#EC4899',
 '[
   {"id":"q1","text":"I can take calculated risks or admit mistakes on my team without fear of public embarrassment.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"My unique skills and perspective are valued by my teammates.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"Different perspectives and ideas are actively welcomed during discussions.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q4","text":"Can you share an example of a practice that makes you feel included or excluded in your team?","type":"text","required":false}
 ]'::jsonb),

('Manager Effectiveness 180° Check', 'Anonymous bi-annual feedback on line manager effectiveness covering communication, priorities and development.', 'feedback', 'users', '#F59E0B',
 '[
   {"id":"q1","text":"My manager provides regular, constructive feedback on my work.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"My manager effectively prioritises tasks and shields the team from unnecessary chaos.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"My manager actively supports my personal career development and training interests.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q4","text":"My manager demonstrates empathy and respect for personal life boundaries.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q5","text":"What is one thing your manager should Start, Stop, or Continue doing?","type":"text","required":false}
 ]'::jsonb),

('Cross-Department Collaboration Survey', 'Quarterly check on inter-departmental communication, collaboration and friction points.', 'operations', 'git-merge', '#64748B',
 '[
   {"id":"q1","text":"Information and decisions flow smoothly between my department and other teams.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"Other departments collaborate willingly when joint projects arise.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"Which department do you experience the most operational friction with?","type":"text","required":false},
   {"id":"q4","text":"What process change would immediately improve cross-department working?","type":"text","required":false}
 ]'::jsonb),

('Post-Event / All-Hands Feedback', 'Quick post-event feedback on value, content clarity and format preferences.', 'engagement', 'calendar', '#6366F1',
 '[
   {"id":"q1","text":"Overall, how valuable did you find today''s All-Hands / Company Event?","type":"scale","min":1,"max":5,"labels":["Not valuable","Very valuable"],"required":true},
   {"id":"q2","text":"The topics presented gave me clear visibility into company performance and priorities.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"What topic or format change would you like to see at our next company gathering?","type":"text","required":false}
 ]'::jsonb),

('HR & Operations Service Satisfaction', 'Annual audit of HR service quality, self-service usability and payroll accuracy.', 'operations', 'settings', '#64748B',
 '[
   {"id":"q1","text":"HR and People Ops respond to my queries in a timely, helpful manner.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q2","text":"It is easy to find internal HR policies, pay information, and request annual leave.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q3","text":"Payroll and expense reimbursements are processed accurately and on time.","type":"scale","min":1,"max":5,"labels":["Strongly disagree","Strongly agree"],"required":true},
   {"id":"q4","text":"How can internal HR and administrative processes be made easier for you?","type":"text","required":false}
 ]'::jsonb);
