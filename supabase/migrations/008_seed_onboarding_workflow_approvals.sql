-- ============================================
-- 008: Seed onboarding, more employees, workflow items, and approval data
-- Run AFTER 006 and 007
-- ============================================

-- Fix expense_claims status constraint to allow 'submitted'
ALTER TABLE public.expense_claims DROP CONSTRAINT IF EXISTS expense_claims_status_check;
ALTER TABLE public.expense_claims ADD CONSTRAINT expense_claims_status_check
  CHECK (status IN ('draft', 'submitted', 'pending', 'approved', 'rejected'));

-- Add notification_type to notifications for icon differentiation
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS notification_type TEXT DEFAULT 'info';
-- Types: expense_approved, expense_declined, leave_approved, leave_declined,
--        birthday, sick_leave, jury_service, expense_action, leave_action, kudos, general

-- Add more employees with managers and varied data
INSERT INTO employees (id, employee_number, first_name, last_name, email, job_title, department, manager_id, start_date, phone, is_admin, is_active)
VALUES
  ('d4e5f6a7-b8c9-0123-defa-234567890123', 'EMP004', 'Timmy', 'Tester', 'timmy.tester@kumonix.com', 'IT Manager', 'IT', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2025-12-15', '07700123456', FALSE, TRUE),
  ('e5f6a7b8-c9d0-1234-efab-345678901234', 'EMP005', 'Shane', 'Lynch', 'shane.lynch@kumonix.com', 'Director', 'Leadership', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2025-08-28', '07700234567', FALSE, TRUE),
  ('f6a7b8c9-d0e1-2345-fabc-456789012345', 'EMP006', 'Daniel', 'Stradling', 'dan.stradling@kumonix.com', 'Director', 'Leadership', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2025-12-01', '07700345678', FALSE, TRUE),
  ('a7b8c9d0-e1f2-3456-abcd-567890123456', 'EMP007', 'Tanya', 'Rumney', 'tanya.rumney@kumonix.com', 'Legal Administrator', 'Back Office', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2025-09-10', '07700456789', FALSE, TRUE),
  ('b8c9d0e1-f2a3-4567-bcde-678901234567', 'EMP008', 'David', 'Davis', 'david.davis@kumonix.com', 'Lawyer', 'Legal', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2025-09-10', '07700567890', FALSE, TRUE),
  ('c9d0e1f2-a3b4-5678-cdef-789012345678', 'EMP009', 'Deborah', 'Bell', 'deborah.bell@kumonix.com', 'Sales Manager', 'Sales', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2025-10-10', '07700678901', FALSE, TRUE),
  ('d0e1f2a3-b4c5-6789-defa-890123456789', 'EMP010', 'Henry', 'Smith', 'henry.smith@kumonix.com', 'IT Manager', 'Consultants', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '2026-05-08', '07700789012', FALSE, TRUE)
ON CONFLICT (employee_number) DO NOTHING;

-- Seed onboarding records
INSERT INTO onboarding (
  user_action, status, firstname, surname, start_date, user_email, display_name,
  job_title, employee_number, department, manager, manager_email,
  contract_type, location, telephone, gender, date_of_birth,
  address_line_1, address_line_2, address_line_3, security_clearance, elearning
) VALUES
  ('Joiner', 'Onboarded', 'Andy', 'Jones', '2024-01-15', 'andy.jones@kumonix.com', 'Andy Jones',
   'CEO', '1', 'Leadership', NULL, NULL,
   'Full-time', 'London', '07700111222', 'Male', '1985-08-22',
   '12 Beak Street', 'Croxley', 'London', 'level2', TRUE),

  ('Joiner', 'Onboarded', 'Timmy', 'Tester', '2025-12-15', 'timmy.tester@kumonix.com', 'Timmy Tester',
   'IT Manager', '11111', 'IT', 'Andy Jones', 'andy.jones@kumonix.com',
   'Full-time', 'London', '07700123456', 'Male', '1992-07-20',
   '5 High Street', 'Watford', 'Hertfordshire', 'level1', TRUE),

  ('Joiner', 'Onboarded', 'Shane', 'Lynch', '2025-08-28', 'shane.lynch@kumonix.com', 'Shane Lynch',
   'Director', '3', 'Leadership', 'Andy Jones', 'andy.jones@kumonix.com',
   'Full-time', 'London', '07700234567', 'Male', '1988-03-15',
   '22 Park Lane', 'Mayfair', 'London', 'level2', FALSE),

  ('Joiner', 'Onboarded', 'Daniel', 'Stradling', '2025-12-01', 'dan.stradling@kumonix.com', 'Daniel Stradling',
   'Director', '2', 'Leadership', 'Andy Jones', 'andy.jones@kumonix.com',
   'Full-time', 'London', '07700345678', 'Male', '1990-11-05',
   '8 Victoria Road', 'Richmond', 'London', 'level2', FALSE),

  ('Joiner', 'new', 'Tanya', 'Rumney', '2025-09-10', 'tanya.rumney@kumonix.com', 'Tanya Rumney',
   'Legal Administrator', '200', 'Back Office', 'Andy Jones', 'andy.jones@kumonix.com',
   'Permanent', 'Lake Jeffreyburgh', '1895342677', 'Female', '1998-09-22',
   NULL, NULL, NULL, NULL, FALSE),

  ('Joiner', 'new', 'David', 'Davis', '2025-09-10', 'david.davis@kumonix.com', 'David Davis',
   'Lawyer', '201', 'Legal', 'Andy Jones', 'andy.jones@kumonix.com',
   'Permanent', 'London', '1895342677', 'Male', '1998-09-23',
   NULL, NULL, NULL, NULL, FALSE),

  ('Joiner', 'new', 'Deborah', 'Bell', '2025-10-10', 'deborah.bell@kumonix.com', 'Deborah Bell',
   'Sales Manager', '202', 'Sales', 'Andy Jones', 'andy.jones@kumonix.com',
   'Permanent', 'London', '1895342677', 'Female', '1998-09-24',
   NULL, NULL, NULL, NULL, FALSE),

  ('Joiner', 'new', 'Henry', 'Smith', '2026-05-08', 'henry.smith@kumonix.com', 'Henry Smith',
   'IT Manager', '344', 'Consultants', 'Andy Jones', 'andy.jones@kumonix.com',
   'Contract', 'London', '4234324324', 'Male', '2017-05-17',
   '11 Baldwins Lane', 'Rickmansworth', 'London', NULL, FALSE);

-- Create expense claims from other employees for Andy to approve
INSERT INTO expense_claims (employee_id, reference_number, title, description, amount, status, category, submitted_at, created_at)
VALUES
  ('d4e5f6a7-b8c9-0123-defa-234567890123', 'EXP-3098', 'Team lunch December', 'Team Christmas lunch at Nandos', 145.50, 'submitted', 'Meals', '2026-07-19T19:34:00Z', '2026-07-18T10:00:00Z'),
  ('e5f6a7b8-c9d0-1234-efab-345678901234', 'EXP-3101', 'Client travel Birmingham', 'Return train tickets and taxi', 287.00, 'submitted', 'Travel', '2026-07-18T14:20:00Z', '2026-07-17T09:00:00Z'),
  ('f6a7b8c9-d0e1-2345-fabc-456789012345', 'EXP-3105', 'Software subscription renewal', 'Annual Figma license', 168.00, 'submitted', 'Software', '2026-07-17T11:00:00Z', '2026-07-16T15:30:00Z');

-- Add line items for these claims
INSERT INTO expense_line_items (expense_claim_id, title, expense_type, description, amount, date_of_purchase)
SELECT id, 'Team Christmas lunch', 'Client entertainment', 'Nandos lunch for 8 people', 145.50, '2026-12-15'
FROM expense_claims WHERE reference_number = 'EXP-3098';

INSERT INTO expense_line_items (expense_claim_id, title, expense_type, description, amount, date_of_purchase)
SELECT id, 'Train Birmingham return', 'Trains', 'Avanti West Coast return', 189.00, '2026-07-15'
FROM expense_claims WHERE reference_number = 'EXP-3101';

INSERT INTO expense_line_items (expense_claim_id, title, expense_type, description, amount, date_of_purchase)
SELECT id, 'Taxi to client office', 'Taxis', 'Birmingham New Street to client', 98.00, '2026-07-15'
FROM expense_claims WHERE reference_number = 'EXP-3101';

INSERT INTO expense_line_items (expense_claim_id, title, expense_type, description, amount, date_of_purchase)
SELECT id, 'Figma annual license', 'Software or subscriptions', 'Annual team license renewal', 168.00, '2026-07-16'
FROM expense_claims WHERE reference_number = 'EXP-3105';

-- Create workflow entries for expense approvals (Andy is approver)
INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, approval_id, reminder_count, task_description, created_at)
SELECT 'Timmy Tester', 1, 'Pending', 'Expense', 'Expense claim submitted for approval',
  'timmy.tester@kumonix.com', 'andy.jones@kumonix.com', id, 1,
  'Expense claim EXP-3098 - Team lunch December - £145.50',
  '2026-07-19T19:34:00Z'
FROM expense_claims WHERE reference_number = 'EXP-3098';

INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, approval_id, reminder_count, task_description, created_at)
SELECT 'Shane Lynch', 1, 'Pending', 'Expense', 'Expense claim submitted for approval',
  'shane.lynch@kumonix.com', 'andy.jones@kumonix.com', id, 1,
  'Expense claim EXP-3101 - Client travel Birmingham - £287.00',
  '2026-07-18T14:20:00Z'
FROM expense_claims WHERE reference_number = 'EXP-3101';

INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, approval_id, reminder_count, task_description, created_at)
SELECT 'Daniel Stradling', 1, 'Pending', 'Expense', 'Expense claim submitted for approval',
  'dan.stradling@kumonix.com', 'andy.jones@kumonix.com', id, 1,
  'Expense claim EXP-3105 - Software subscription renewal - £168.00',
  '2026-07-17T11:00:00Z'
FROM expense_claims WHERE reference_number = 'EXP-3105';

-- Create a leave request from Timmy for Andy to approve
INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, status, reason, created_at)
VALUES
  ('d4e5f6a7-b8c9-0123-defa-234567890123', 1, '2026-08-04', '2026-08-08', 5, 'pending', 'Family holiday', '2026-07-19T17:34:00Z');

-- Create workflow entry for leave approval
INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, approval_id, reminder_count, task_description, created_at)
SELECT 'Timmy Tester', 1, 'Pending', 'Leave', 'Annual Leave request submitted',
  'timmy.tester@kumonix.com', 'andy.jones@kumonix.com', id, 1,
  'Annual Leave - 04/08/2026 to 08/08/2026 - 5 days',
  '2026-07-19T17:34:00Z'
FROM leave_requests WHERE employee_id = 'd4e5f6a7-b8c9-0123-defa-234567890123' AND start_date = '2026-08-04';

-- Birthday notification for Timmy (birthday today = July 20)
INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, reminder_count, task_description, approval_status, created_at)
VALUES
  ('Timmy Tester', 1, 'Complete', 'Birthday', 'Birthday wishes',
   'timmy.tester@kumonix.com', 'timmy.tester@kumonix.com', 1,
   'Here''s Wishing you a great day on your Birthday, Enjoy!', 'Notified',
   '2026-07-20T08:00:00Z');

-- Some completed notifications for My Notifications tab
INSERT INTO workflow_tracker (emp_display_name, step, status, record_type, action, employee_email, assigned_to, reminder_count, task_description, approval_status, created_at)
VALUES
  ('Andy Jones', 1, 'Complete', 'Expense', 'Expense claim approved',
   'andy.jones@kumonix.com', 'andy.jones@kumonix.com', 1,
   'Your expense claim EXP-084 for £256.00 has been approved', 'Approved',
   '2026-07-15T10:00:00Z'),
  ('Andy Jones', 1, 'Complete', 'Leave', 'Annual Leave approved',
   'andy.jones@kumonix.com', 'andy.jones@kumonix.com', 1,
   'Your Annual Leave from 04/08/2026 to 15/08/2026 has been approved. Enjoy your time off! 🌴', 'Approved',
   '2026-07-14T09:00:00Z');

-- Add leave types for sick leave and jury service if not already present
INSERT INTO leave_types (name, default_allowance, colour)
VALUES
  ('Jury Service', 0, '#ff9800'),
  ('Bereavement Leave', 5, '#616161'),
  ('Study Leave', 5, '#3f51b5')
ON CONFLICT (name) DO NOTHING;
