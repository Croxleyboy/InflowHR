-- Move e-learning courses from hardcoded array to DB table
CREATE TABLE IF NOT EXISTS elearning_courses (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'onboarding',
  type text NOT NULL DEFAULT 'article' CHECK (type IN ('video','article','quiz','policy')),
  duration text NOT NULL DEFAULT '10 min',
  required boolean NOT NULL DEFAULT false,
  deadline date,
  tags text[] NOT NULL DEFAULT '{}',
  annual_reminder boolean NOT NULL DEFAULT false,
  industry text,
  external_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed with existing 37 courses
INSERT INTO elearning_courses (id, title, description, category, type, duration, required, deadline, tags, annual_reminder, industry) VALUES
  -- Onboarding
  ('onb-getting-started', 'Getting Started with InflowHR', 'A comprehensive FAQ guide covering every feature of your HR app.', 'onboarding', 'article', '20 min', true, NULL, ARRAY['new-starter','faq'], false, NULL),
  ('onb-welcome', 'Welcome to Kumonix', 'An introductory video covering the company vision and values.', 'onboarding', 'video', '12 min', true, '2026-08-01', ARRAY['new-starter'], false, NULL),
  ('onb-systems', 'Systems & Tools Overview', 'Learn about the key systems you will use day-to-day.', 'onboarding', 'article', '8 min', true, '2026-08-01', ARRAY['new-starter'], false, NULL),
  ('onb-culture', 'Company Culture & Values', 'Understand the culture that drives our organisation.', 'onboarding', 'video', '15 min', true, '2026-08-01', ARRAY['new-starter'], false, NULL),
  -- Compliance
  ('comp-gdpr', 'GDPR & Data Protection', 'Understand your obligations under UK GDPR.', 'compliance', 'quiz', '20 min', true, '2026-09-01', ARRAY['compliance'], true, NULL),
  ('comp-health', 'Health & Safety', 'Mandatory health and safety training.', 'compliance', 'quiz', '25 min', true, '2026-09-01', ARRAY['compliance'], true, NULL),
  ('comp-antibrib', 'Anti-Bribery & Corruption', 'Learn about anti-bribery policies and procedures.', 'compliance', 'quiz', '15 min', true, '2026-09-15', ARRAY['compliance'], true, NULL),
  ('comp-cybersec', 'Cyber Security Awareness', 'Protect yourself and the company from cyber threats.', 'compliance', 'quiz', '20 min', true, '2026-09-01', ARRAY['compliance'], true, NULL),
  ('comp-dei', 'Diversity, Equity & Inclusion', 'Building an inclusive workplace for everyone.', 'compliance', 'video', '25 min', true, '2026-10-01', ARRAY['compliance'], true, NULL),
  ('comp-modern-slavery', 'Modern Slavery Awareness', 'Recognise and report signs of modern slavery.', 'compliance', 'quiz', '15 min', true, '2026-10-01', ARRAY['compliance'], true, NULL),
  ('comp-fire', 'Fire Safety', 'Fire prevention, evacuation procedures and your responsibilities.', 'compliance', 'quiz', '15 min', true, '2026-09-01', ARRAY['compliance'], true, NULL),
  ('comp-mhfa', 'Mental Health First Aid', 'Supporting colleagues with mental health challenges.', 'compliance', 'video', '30 min', false, NULL, ARRAY['compliance','wellbeing'], false, NULL),
  ('comp-env', 'Environmental Awareness', 'Reducing environmental impact in the workplace.', 'compliance', 'article', '15 min', false, NULL, ARRAY['compliance'], false, NULL),
  -- Policies
  ('pol-handbook', 'Employee Handbook', 'Review the employee handbook and key policies.', 'policies', 'policy', '10 min', false, NULL, ARRAY['policy'], false, NULL),
  ('pol-expenses', 'Expenses Policy', 'How to submit and manage expense claims.', 'policies', 'policy', '5 min', false, NULL, ARRAY['policy'], false, NULL),
  ('pol-remote', 'Remote Working Guide', 'Best practices for working remotely.', 'policies', 'article', '10 min', false, NULL, ARRAY['policy'], false, NULL),
  ('pol-social-media', 'Social Media Policy', 'Guidelines for professional use of social media.', 'policies', 'policy', '8 min', false, NULL, ARRAY['policy'], false, NULL),
  -- Role / Skills
  ('role-agile', 'Agile Methodology', 'Introduction to agile principles and practices.', 'role', 'video', '30 min', false, NULL, ARRAY['skills'], false, NULL),
  ('role-present', 'Presentation Skills', 'Improve your presentation and public speaking abilities.', 'role', 'video', '22 min', false, NULL, ARRAY['skills'], false, NULL),
  ('role-time-mgmt', 'Time Management', 'Techniques for better time management and productivity.', 'role', 'article', '12 min', false, NULL, ARRAY['skills'], false, NULL),
  ('role-conflict', 'Conflict Resolution', 'Handle workplace conflicts professionally and effectively.', 'role', 'video', '18 min', false, NULL, ARRAY['skills'], false, NULL),
  -- Development
  ('dev-leadership', 'Leadership Essentials', 'Core leadership skills for emerging managers.', 'development', 'video', '35 min', false, NULL, ARRAY['growth'], false, NULL),
  ('dev-feedback', 'Giving & Receiving Feedback', 'Master the art of constructive feedback.', 'development', 'article', '12 min', false, NULL, ARRAY['growth'], false, NULL),
  ('dev-coaching', 'Coaching Skills', 'Learn coaching techniques to support your team.', 'development', 'video', '25 min', false, NULL, ARRAY['growth'], false, NULL),
  ('dev-project-mgmt', 'Project Management', 'Fundamentals of effective project management.', 'development', 'video', '30 min', false, NULL, ARRAY['growth'], false, NULL),
  -- Wellbeing
  ('wellbeing-stress', 'Stress Management', 'Recognise and manage workplace stress.', 'wellbeing', 'video', '18 min', false, NULL, ARRAY['wellbeing'], false, NULL),
  ('wellbeing-ergo', 'Ergonomics & Desk Setup', 'Set up your workspace for comfort and health.', 'wellbeing', 'article', '8 min', false, NULL, ARRAY['wellbeing'], false, NULL),
  ('wellbeing-financial', 'Financial Wellbeing', 'Tools and tips for financial health and planning.', 'wellbeing', 'article', '15 min', false, NULL, ARRAY['wellbeing'], false, NULL),
  -- Legal industry
  ('legal-sra', 'SRA Compliance', 'Solicitors Regulation Authority standards and obligations.', 'compliance', 'quiz', '30 min', true, NULL, ARRAY['compliance'], true, 'legal'),
  ('legal-aml', 'Anti-Money Laundering (Legal)', 'AML obligations specific to legal practices.', 'compliance', 'quiz', '25 min', true, NULL, ARRAY['compliance'], true, 'legal'),
  ('legal-conflict-interest', 'Conflicts of Interest', 'Identifying and managing conflicts of interest.', 'compliance', 'quiz', '20 min', true, NULL, ARRAY['compliance'], true, 'legal'),
  ('legal-client-money', 'Client Money Handling', 'Rules for handling client money in legal practice.', 'compliance', 'quiz', '20 min', true, NULL, ARRAY['compliance'], true, 'legal'),
  ('legal-prof-ethics', 'Professional Ethics (Legal)', 'Ethical standards for legal professionals.', 'development', 'video', '25 min', false, NULL, ARRAY['growth'], false, 'legal'),
  ('legal-cpd', 'CPD Requirements (Legal)', 'Continuing professional development for solicitors.', 'development', 'article', '10 min', false, NULL, ARRAY['growth'], false, 'legal'),
  -- Education industry
  ('edu-safeguarding', 'Safeguarding Children', 'Essential safeguarding training for education staff.', 'compliance', 'quiz', '35 min', true, NULL, ARRAY['compliance'], true, 'education'),
  ('edu-prevent', 'Prevent Duty', 'Counter-terrorism awareness for education settings.', 'compliance', 'quiz', '25 min', true, NULL, ARRAY['compliance'], true, 'education'),
  ('edu-send', 'SEND Awareness', 'Supporting learners with special educational needs.', 'compliance', 'video', '30 min', true, NULL, ARRAY['compliance'], true, 'education'),
  ('edu-online-safety', 'Online Safety', 'Keeping students safe online.', 'compliance', 'quiz', '20 min', true, NULL, ARRAY['compliance'], true, 'education'),
  ('edu-behaviour', 'Behaviour Management', 'Strategies for positive behaviour management.', 'role', 'video', '25 min', false, NULL, ARRAY['skills'], false, 'education'),
  ('edu-ofsted', 'Ofsted Preparation', 'Understanding Ofsted inspections and preparation.', 'development', 'article', '20 min', false, NULL, ARRAY['growth'], false, 'education'),
  -- Accountancy industry
  ('acc-aml', 'Anti-Money Laundering (Accountancy)', 'AML requirements for accounting firms.', 'compliance', 'quiz', '25 min', true, NULL, ARRAY['compliance'], true, 'accountancy'),
  ('acc-ethics', 'Professional Ethics (Accountancy)', 'Ethical standards for accounting professionals.', 'compliance', 'quiz', '20 min', true, NULL, ARRAY['compliance'], true, 'accountancy'),
  ('acc-tax-update', 'Tax Legislation Update', 'Stay current with UK tax legislation changes.', 'compliance', 'video', '30 min', true, NULL, ARRAY['compliance'], true, 'accountancy'),
  ('acc-audit-standards', 'Auditing Standards', 'Key auditing standards and best practices.', 'compliance', 'quiz', '25 min', true, NULL, ARRAY['compliance'], true, 'accountancy'),
  ('acc-client-conf', 'Client Confidentiality', 'Maintaining client confidentiality in accounting.', 'compliance', 'quiz', '15 min', true, NULL, ARRAY['compliance'], true, 'accountancy'),
  ('acc-cpd', 'CPD Requirements (Accountancy)', 'Continuing professional development for accountants.', 'development', 'article', '10 min', false, NULL, ARRAY['growth'], false, 'accountancy')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE elearning_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "elearning_courses_read" ON elearning_courses FOR SELECT USING (true);
CREATE POLICY "elearning_courses_write" ON elearning_courses FOR ALL USING (true) WITH CHECK (true);
