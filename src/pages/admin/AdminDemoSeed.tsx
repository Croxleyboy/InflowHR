import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const COMPANY_ID = '11111111-1111-1111-1111-111111111111'

const EMPLOYEES = [
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', num: 'EMP001', first: 'Andy',  last: 'Jones',    email: 'andy.jones@kumonix.com',     title: 'Head of IT',       dept: 'IT',          admin: true,  notify: true,  salary: 65000 },
  { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', num: 'EMP002', first: 'Sarah', last: 'Mitchell', email: 'sarah.mitchell@kumonix.com', title: 'Software Engineer',dept: 'Engineering', admin: false, notify: false, salary: 48000 },
  { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', num: 'EMP003', first: 'James', last: 'Patel',    email: 'james.patel@kumonix.com',    title: 'Product Designer', dept: 'Design',      admin: false, notify: false, salary: 45000 },
  { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', num: 'EMP004', first: 'Emma',  last: 'Chen',     email: 'emma.chen@kumonix.com',      title: 'HR Manager',       dept: 'HR',          admin: false, notify: true,  salary: 52000 },
  { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', num: 'EMP005', first: 'Tom',   last: 'Williams', email: 'tom.williams@kumonix.com',   title: 'Finance Analyst',  dept: 'Finance',     admin: false, notify: false, salary: 38000 },
]

export default function AdminDemoSeed() {
  const { user } = useAuth()
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [done, setDone] = useState(false)

  function addLog(msg: string) {
    setLog(prev => [...prev, msg])
  }

  async function runSeed() {
    if (!confirm('This will DELETE ALL DATA and reseed with demo data. Are you sure?')) return
    setRunning(true)
    setLog([])
    setDone(false)

    try {
      // Step 1: Delete all data (order matters for FK constraints)
      addLog('Clearing all tables...')
      for (const table of [
        'workflow_tracker', 'notifications', 'expense_line_items', 'expense_claims',
        'leave_requests', 'leave_balances', 'course_enrolments', 'employee_benefits',
        'performance_reviews', 'kudos', 'payslips', 'onboarding', 'announcements',
        'user_settings', 'app_settings', 'company_users', 'employees',
        'leave_types', 'benefits', 'courses', 'companies',
      ]) {
        await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
        addLog(`  Cleared ${table}`)
      }

      // Step 2: Create company
      addLog('Creating Kumonix company...')
      await supabase.from('companies').insert({
        id: COMPANY_ID,
        name: 'Kumonix',
        microsoft_tenant_id: 'placeholder-tenant-id',
        domain: 'kumonix.com',
        is_active: true,
      })

      // Step 3: Create employees
      addLog('Creating 5 employees...')
      const andy = EMPLOYEES[0]
      await supabase.from('employees').insert(
        EMPLOYEES.map(e => ({
          id: e.id,
          employee_number: e.num,
          first_name: e.first,
          last_name: e.last,
          email: e.email,
          job_title: e.title,
          department: e.dept,
          manager_id: e.id === andy.id ? null : andy.id,
          start_date: e.id === andy.id ? '2022-01-10' : e.id === EMPLOYEES[1].id ? '2023-03-15' : e.id === EMPLOYEES[2].id ? '2023-06-01' : e.id === EMPLOYEES[3].id ? '2022-09-01' : '2024-01-08',
          phone: `+44 7700 10000${EMPLOYEES.indexOf(e) + 1}`,
          is_admin: e.admin,
          is_active: true,
          can_post_notifications: e.notify,
          company_id: COMPANY_ID,
        }))
      )

      // Step 4: Link auth user
      addLog('Linking auth user (andy.jones@kumonix.com)...')
      if (user) {
        await supabase.from('company_users').insert({
          auth_user_id: user.id,
          company_id: COMPANY_ID,
          employee_id: andy.id,
          role: 'admin',
          is_active: true,
        })
      }

      // Step 5: Leave types
      addLog('Creating leave types...')
      await supabase.from('leave_types').insert([
        { name: 'Annual Leave',    default_allowance: 25, colour: '#4caf50', is_active: true, company_id: COMPANY_ID },
        { name: 'Sick Leave',      default_allowance: 10, colour: '#f44336', is_active: true, company_id: COMPANY_ID },
        { name: 'Parental Leave',  default_allowance: 14, colour: '#9c27b0', is_active: true, company_id: COMPANY_ID },
        { name: 'Compassionate',   default_allowance: 5,  colour: '#607d8b', is_active: true, company_id: COMPANY_ID },
        { name: 'Work From Home',  default_allowance: 999,colour: '#2196f3', is_active: true, company_id: COMPANY_ID },
      ])

      // Get leave type IDs
      const { data: ltData } = await supabase.from('leave_types').select('id, name').eq('company_id', COMPANY_ID)
      const ltMap: Record<string, number> = {}
      ltData?.forEach(lt => { ltMap[lt.name] = lt.id })

      // Step 6: Leave balances
      addLog('Creating leave balances...')
      const balances = EMPLOYEES.map(e => ([
        { employee_id: e.id, leave_type_id: ltMap['Annual Leave'], year: 2026, total_allowance: e.id === andy.id ? 28 : 25, used: [5,8,3,6,2][EMPLOYEES.indexOf(e)], carried_over: e.id === andy.id ? 3 : e.id === EMPLOYEES[3].id ? 2 : 0, company_id: COMPANY_ID },
        { employee_id: e.id, leave_type_id: ltMap['Sick Leave'],   year: 2026, total_allowance: 10, used: [1,2,0,1,0][EMPLOYEES.indexOf(e)], carried_over: 0, company_id: COMPANY_ID },
      ])).flat()
      await supabase.from('leave_balances').insert(balances)

      // Step 7: Leave requests
      addLog('Creating leave requests...')
      await supabase.from('leave_requests').insert([
        { employee_id: andy.id, leave_type_id: ltMap['Annual Leave'], start_date: '2026-08-04', end_date: '2026-08-08', days_requested: 5, status: 'approved', reason: 'Summer holiday', approved_by: EMPLOYEES[3].id, company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[1].id, leave_type_id: ltMap['Annual Leave'], start_date: '2026-07-28', end_date: '2026-07-30', days_requested: 3, status: 'pending', reason: 'Family event', company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[1].id, leave_type_id: ltMap['Sick Leave'], start_date: '2026-06-16', end_date: '2026-06-17', days_requested: 2, status: 'approved', reason: 'Feeling unwell', approved_by: andy.id, company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[2].id, leave_type_id: ltMap['Annual Leave'], start_date: '2026-09-01', end_date: '2026-09-05', days_requested: 5, status: 'pending', reason: 'Conference travel', company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[3].id, leave_type_id: ltMap['Annual Leave'], start_date: '2026-12-23', end_date: '2026-12-31', days_requested: 6, status: 'approved', reason: 'Christmas break', approved_by: andy.id, company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[4].id, leave_type_id: ltMap['Annual Leave'], start_date: '2026-08-18', end_date: '2026-08-19', days_requested: 2, status: 'pending', reason: 'Moving house', company_id: COMPANY_ID },
        { employee_id: andy.id, leave_type_id: ltMap['Sick Leave'], start_date: '2026-05-12', end_date: '2026-05-12', days_requested: 1, status: 'approved', reason: 'Dental appointment', approved_by: EMPLOYEES[3].id, company_id: COMPANY_ID },
      ])

      // Step 8: Expense claims
      addLog('Creating expense claims...')
      const claims = [
        { employee_id: andy.id, reference_number: 'EXP-2026-001', title: 'Client lunch meeting', description: 'Lunch with Acme Corp', amount: 85.50, status: 'approved', category: 'Meals', submitted_at: '2026-07-01T10:00:00Z', start_date: '2026-07-01', end_date: '2026-07-01', company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[1].id, reference_number: 'EXP-2026-002', title: 'Train to London office', description: 'Return ticket Kings Cross', amount: 124.00, status: 'pending', category: 'Travel', submitted_at: '2026-07-10T14:00:00Z', start_date: '2026-07-10', end_date: '2026-07-10', company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[2].id, reference_number: 'EXP-2026-003', title: 'Design software licence', description: 'Figma annual renewal', amount: 168.00, status: 'submitted', category: 'Software', submitted_at: '2026-07-15T09:00:00Z', start_date: '2026-07-15', end_date: '2026-07-15', company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[4].id, reference_number: 'EXP-2026-004', title: 'Office supplies', description: 'Stationery & notebooks', amount: 42.99, status: 'draft', category: 'Office Supplies', start_date: '2026-07-18', end_date: '2026-07-18', company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[3].id, reference_number: 'EXP-2026-005', title: 'Team building dinner', description: 'Team meal at Nandos', amount: 210.75, status: 'approved', category: 'Meals', submitted_at: '2026-06-20T11:00:00Z', start_date: '2026-06-20', end_date: '2026-06-20', company_id: COMPANY_ID },
      ]
      const { data: claimData } = await supabase.from('expense_claims').insert(claims).select('id, reference_number')

      // Step 9: Expense line items
      if (claimData) {
        addLog('Creating expense line items...')
        const claimIds: Record<string, number> = {}
        claimData.forEach(c => { claimIds[c.reference_number] = c.id })
        await supabase.from('expense_line_items').insert([
          { expense_claim_id: claimIds['EXP-2026-001'], title: 'Restaurant bill', expense_type: 'Meals', description: 'Italian restaurant', date_of_purchase: '2026-07-01', amount: 72.00, company_id: COMPANY_ID },
          { expense_claim_id: claimIds['EXP-2026-001'], title: 'Taxi to restaurant', expense_type: 'Travel', description: 'Uber return trip', date_of_purchase: '2026-07-01', amount: 13.50, company_id: COMPANY_ID },
          { expense_claim_id: claimIds['EXP-2026-002'], title: 'Train ticket outbound', expense_type: 'Travel', description: 'Kings Cross return', date_of_purchase: '2026-07-10', amount: 62.00, company_id: COMPANY_ID },
          { expense_claim_id: claimIds['EXP-2026-002'], title: 'Train ticket return', expense_type: 'Travel', description: 'Kings Cross return', date_of_purchase: '2026-07-10', amount: 62.00, company_id: COMPANY_ID },
          { expense_claim_id: claimIds['EXP-2026-003'], title: 'Figma licence', expense_type: 'Software', description: 'Annual subscription', date_of_purchase: '2026-07-15', amount: 168.00, company_id: COMPANY_ID },
          { expense_claim_id: claimIds['EXP-2026-004'], title: 'Notebooks and pens', expense_type: 'Office Supplies', description: 'WHSmith purchase', date_of_purchase: '2026-07-18', amount: 42.99, company_id: COMPANY_ID },
          { expense_claim_id: claimIds['EXP-2026-005'], title: 'Restaurant bill', expense_type: 'Meals', description: 'Team dinner 6 people', date_of_purchase: '2026-06-20', amount: 185.75, company_id: COMPANY_ID },
          { expense_claim_id: claimIds['EXP-2026-005'], title: 'Drinks', expense_type: 'Meals', description: 'Soft drinks', date_of_purchase: '2026-06-20', amount: 25.00, company_id: COMPANY_ID },
        ])
      }

      // Step 10: Payslips (Apr-Jul 2026)
      addLog('Creating payslips (4 months x 5 employees)...')
      const months = [
        { start: '2026-04-01', end: '2026-04-30', pay: '2026-04-28', status: 'paid' },
        { start: '2026-05-01', end: '2026-05-31', pay: '2026-05-28', status: 'paid' },
        { start: '2026-06-01', end: '2026-06-30', pay: '2026-06-26', status: 'paid' },
        { start: '2026-07-01', end: '2026-07-31', pay: '2026-07-28', status: 'processed' },
      ]
      const payslips = EMPLOYEES.flatMap(e => {
        const monthly = Math.round(e.salary / 12 * 100) / 100
        const tax = Math.round(monthly * 0.2 * 100) / 100
        const ni = Math.round(monthly * 0.08 * 100) / 100
        const pension = Math.round(monthly * 0.05 * 100) / 100
        const net = Math.round((monthly - tax - ni - pension) * 100) / 100
        const initials = e.first[0] + e.last[0]
        return months.map((m, mi) => ({
          employee_id: e.id,
          reference_number: `PAY-2026-${String(mi + 4).padStart(2, '0')}-${initials}`,
          pay_period_start: m.start, pay_period_end: m.end,
          gross_pay: monthly, tax, national_insurance: ni, pension,
          other_deductions: 0, net_pay: net, payment_date: m.pay,
          status: m.status, tax_code: '1257L', annual_salary: e.salary,
          payroll_id: `KMX-${String(EMPLOYEES.indexOf(e) + 1).padStart(3, '0')}`,
          bank_account: `****${String(1000 + EMPLOYEES.indexOf(e) * 1111)}`,
          payroll_office: 'London', overtime: 0, adjustments: 0, monthly_deductions: 0,
          company_id: COMPANY_ID,
        }))
      })
      await supabase.from('payslips').insert(payslips)

      // Step 11: Kudos
      addLog('Creating kudos...')
      await supabase.from('kudos').insert([
        { from_employee_id: andy.id, to_employee_id: EMPLOYEES[1].id, message: 'Brilliant work on the API refactor - shipped two days early!', category: 'innovation', recognition_type: 'recognition', badge: 'star', quality: 'Innovation', like_count: 3, liked_by: [EMPLOYEES[2].id, EMPLOYEES[3].id, EMPLOYEES[4].id], company_id: COMPANY_ID },
        { from_employee_id: EMPLOYEES[1].id, to_employee_id: EMPLOYEES[2].id, message: 'The new dashboard mockups look incredible. Thanks for the quick turnaround!', category: 'teamwork', recognition_type: 'recognition', badge: 'heart', quality: 'Teamwork', like_count: 2, liked_by: [andy.id, EMPLOYEES[4].id], company_id: COMPANY_ID },
        { from_employee_id: EMPLOYEES[3].id, to_employee_id: andy.id, message: 'Thank you for mentoring the new joiners - they all feel so welcome!', category: 'leadership', recognition_type: 'recognition', badge: 'trophy', quality: 'Leadership', like_count: 4, liked_by: [EMPLOYEES[1].id, EMPLOYEES[2].id, EMPLOYEES[3].id, EMPLOYEES[4].id], company_id: COMPANY_ID },
        { from_employee_id: EMPLOYEES[2].id, to_employee_id: EMPLOYEES[4].id, message: 'Great job catching that budget discrepancy before month-end close!', category: 'customer_focus', recognition_type: 'recognition', badge: 'gem', quality: 'Attention to Detail', like_count: 1, liked_by: [andy.id], company_id: COMPANY_ID },
        { from_employee_id: EMPLOYEES[4].id, to_employee_id: null, message: 'Happy Friday everyone! Have a great weekend', recognition_type: 'broadcast', is_broadcast: true, like_count: 2, liked_by: [andy.id, EMPLOYEES[3].id], company_id: COMPANY_ID },
        { from_employee_id: EMPLOYEES[3].id, to_employee_id: EMPLOYEES[1].id, message: 'Your presentation at the all-hands was engaging and clear. Well done!', category: 'going_above', recognition_type: 'recognition', badge: 'rocket', quality: 'Going Above & Beyond', like_count: 1, liked_by: [EMPLOYEES[2].id], company_id: COMPANY_ID },
      ])

      // Step 12: Announcements
      addLog('Creating announcements...')
      await supabase.from('announcements').insert([
        { title: 'Q3 Company All-Hands', body: 'Join us on August 1st at 2pm for the quarterly all-hands meeting. We will cover company performance, upcoming initiatives, and team highlights.', author_id: andy.id, is_pinned: true, published_at: '2026-07-20T09:00:00Z', submitted_by_name: 'Andy Jones', company_id: COMPANY_ID },
        { title: 'Office Closure: August Bank Holiday', body: 'Please note the office will be closed on Monday 31st August for the bank holiday. Normal hours resume Tuesday 1st September.', author_id: EMPLOYEES[3].id, published_at: '2026-07-18T10:00:00Z', submitted_by_name: 'Emma Chen', company_id: COMPANY_ID },
        { title: 'New Benefits Portal Launch', body: 'We are excited to announce the launch of our updated benefits portal. You can now manage your pension contributions, cycle-to-work scheme, and health insurance all in one place.', author_id: EMPLOYEES[3].id, published_at: '2026-07-15T14:00:00Z', submitted_by_name: 'Emma Chen', company_id: COMPANY_ID },
        { title: 'Welcome Tom Williams!', body: 'Please join us in welcoming Tom Williams to the Finance team. Tom joins as Finance Analyst and brings experience from PwC.', author_id: EMPLOYEES[3].id, published_at: '2026-01-08T09:00:00Z', submitted_by_name: 'Emma Chen', company_id: COMPANY_ID },
      ])

      // Step 13: Benefits
      addLog('Creating benefits...')
      await supabase.from('benefits').insert([
        { name: 'Private Health Insurance', description: 'Comprehensive medical cover including dental and optical', category: 'Health', provider: 'Bupa' },
        { name: 'Cycle to Work Scheme', description: 'Tax-free bike purchase up to £2,000', category: 'Lifestyle', provider: 'Cyclescheme' },
        { name: 'Pension', description: 'Employer matches up to 5% of salary', category: 'Financial', provider: 'Aviva' },
        { name: 'Gym Membership', description: 'Discounted corporate rate at PureGym', category: 'Health', provider: 'PureGym' },
        { name: 'Mental Health Support', description: 'Access to counselling and wellbeing app', category: 'Health', provider: 'Headspace' },
      ])

      const { data: benData } = await supabase.from('benefits').select('id, name')
      const benMap: Record<string, number> = {}
      benData?.forEach(b => { benMap[b.name] = b.id })

      // Step 14: Employee benefits
      addLog('Enrolling employees in benefits...')
      await supabase.from('employee_benefits').insert([
        { employee_id: andy.id, benefit_id: benMap['Private Health Insurance'], status: 'active' },
        { employee_id: andy.id, benefit_id: benMap['Pension'], status: 'active' },
        { employee_id: EMPLOYEES[1].id, benefit_id: benMap['Private Health Insurance'], status: 'active' },
        { employee_id: EMPLOYEES[1].id, benefit_id: benMap['Cycle to Work Scheme'], status: 'active' },
        { employee_id: EMPLOYEES[1].id, benefit_id: benMap['Pension'], status: 'active' },
        { employee_id: EMPLOYEES[2].id, benefit_id: benMap['Pension'], status: 'active' },
        { employee_id: EMPLOYEES[2].id, benefit_id: benMap['Gym Membership'], status: 'active' },
        { employee_id: EMPLOYEES[3].id, benefit_id: benMap['Private Health Insurance'], status: 'active' },
        { employee_id: EMPLOYEES[3].id, benefit_id: benMap['Pension'], status: 'active' },
        { employee_id: EMPLOYEES[3].id, benefit_id: benMap['Mental Health Support'], status: 'active' },
        { employee_id: EMPLOYEES[4].id, benefit_id: benMap['Pension'], status: 'active' },
        { employee_id: EMPLOYEES[4].id, benefit_id: benMap['Mental Health Support'], status: 'pending' },
      ])

      // Step 15: Courses
      addLog('Creating eLearning courses...')
      await supabase.from('courses').insert([
        { title: 'Data Protection & GDPR', description: 'Understanding your obligations under UK GDPR', category: 'Compliance', duration_minutes: 45, is_mandatory: true },
        { title: 'Cyber Security Awareness', description: 'Phishing, passwords, and safe browsing', category: 'IT Security', duration_minutes: 30, is_mandatory: true },
        { title: 'Fire Safety', description: 'Evacuation procedures and fire prevention', category: 'Health & Safety', duration_minutes: 20, is_mandatory: true },
        { title: 'Inclusive Leadership', description: 'Building diverse and inclusive teams', category: 'Leadership', duration_minutes: 60, is_mandatory: false },
        { title: 'Introduction to Agile', description: 'Scrum, Kanban, and agile ways of working', category: 'Professional', duration_minutes: 40, is_mandatory: false },
        { title: 'Mental Health First Aid', description: 'Supporting colleagues with mental health challenges', category: 'Wellbeing', duration_minutes: 90, is_mandatory: false },
      ])

      const { data: courseData } = await supabase.from('courses').select('id, title')
      const courseMap: Record<string, number> = {}
      courseData?.forEach(c => { courseMap[c.title] = c.id })

      // Step 16: Course enrolments
      addLog('Creating course enrolments...')
      await supabase.from('course_enrolments').insert([
        { employee_id: andy.id, course_id: courseMap['Data Protection & GDPR'], status: 'completed', progress_pct: 100, started_at: '2026-02-01T10:00:00Z', completed_at: '2026-02-01T10:45:00Z', score: 92 },
        { employee_id: andy.id, course_id: courseMap['Cyber Security Awareness'], status: 'completed', progress_pct: 100, started_at: '2026-02-15T14:00:00Z', completed_at: '2026-02-15T14:30:00Z', score: 88 },
        { employee_id: andy.id, course_id: courseMap['Fire Safety'], status: 'completed', progress_pct: 100, started_at: '2026-03-01T09:00:00Z', completed_at: '2026-03-01T09:20:00Z', score: 95 },
        { employee_id: andy.id, course_id: courseMap['Inclusive Leadership'], status: 'in_progress', progress_pct: 60, started_at: '2026-07-10T11:00:00Z' },
        { employee_id: EMPLOYEES[1].id, course_id: courseMap['Data Protection & GDPR'], status: 'completed', progress_pct: 100, started_at: '2026-04-01T10:00:00Z', completed_at: '2026-04-01T10:40:00Z', score: 85 },
        { employee_id: EMPLOYEES[1].id, course_id: courseMap['Cyber Security Awareness'], status: 'completed', progress_pct: 100, started_at: '2026-04-05T14:00:00Z', completed_at: '2026-04-05T14:25:00Z', score: 90 },
        { employee_id: EMPLOYEES[1].id, course_id: courseMap['Fire Safety'], status: 'in_progress', progress_pct: 40, started_at: '2026-07-15T09:00:00Z' },
        { employee_id: EMPLOYEES[1].id, course_id: courseMap['Introduction to Agile'], status: 'completed', progress_pct: 100, started_at: '2026-05-10T10:00:00Z', completed_at: '2026-05-10T10:40:00Z', score: 78 },
        { employee_id: EMPLOYEES[2].id, course_id: courseMap['Data Protection & GDPR'], status: 'completed', progress_pct: 100, started_at: '2026-07-01T10:00:00Z', completed_at: '2026-07-01T10:50:00Z', score: 91 },
        { employee_id: EMPLOYEES[2].id, course_id: courseMap['Cyber Security Awareness'], status: 'not_started', progress_pct: 0 },
        { employee_id: EMPLOYEES[2].id, course_id: courseMap['Fire Safety'], status: 'not_started', progress_pct: 0 },
        { employee_id: EMPLOYEES[3].id, course_id: courseMap['Data Protection & GDPR'], status: 'completed', progress_pct: 100, started_at: '2026-01-15T10:00:00Z', completed_at: '2026-01-15T10:42:00Z', score: 97 },
        { employee_id: EMPLOYEES[3].id, course_id: courseMap['Cyber Security Awareness'], status: 'completed', progress_pct: 100, started_at: '2026-01-20T14:00:00Z', completed_at: '2026-01-20T14:28:00Z', score: 94 },
        { employee_id: EMPLOYEES[3].id, course_id: courseMap['Fire Safety'], status: 'completed', progress_pct: 100, started_at: '2026-02-01T09:00:00Z', completed_at: '2026-02-01T09:18:00Z', score: 100 },
        { employee_id: EMPLOYEES[3].id, course_id: courseMap['Mental Health First Aid'], status: 'in_progress', progress_pct: 75, started_at: '2026-07-01T10:00:00Z' },
        { employee_id: EMPLOYEES[4].id, course_id: courseMap['Data Protection & GDPR'], status: 'in_progress', progress_pct: 30, started_at: '2026-07-20T10:00:00Z' },
        { employee_id: EMPLOYEES[4].id, course_id: courseMap['Cyber Security Awareness'], status: 'not_started', progress_pct: 0 },
        { employee_id: EMPLOYEES[4].id, course_id: courseMap['Fire Safety'], status: 'not_started', progress_pct: 0 },
      ])

      // Step 17: Performance reviews
      addLog('Creating performance reviews...')
      await supabase.from('performance_reviews').insert([
        { employee_id: EMPLOYEES[1].id, reviewer_id: andy.id, review_period: 'H1 2026', overall_rating: 4, strengths: 'Strong technical skills, reliable delivery, excellent code quality', areas_for_improvement: 'Could contribute more in team meetings', goals: 'Lead a tech talk by end of Q3; mentor one junior developer', status: 'completed', completed_at: '2026-07-01T10:00:00Z' },
        { employee_id: EMPLOYEES[2].id, reviewer_id: andy.id, review_period: 'H1 2026', overall_rating: 4, strengths: 'Creative design thinking, fast iteration, good user empathy', areas_for_improvement: 'Needs to improve stakeholder communication', goals: 'Complete design system v2; run a user research session', status: 'completed', completed_at: '2026-07-02T11:00:00Z' },
        { employee_id: EMPLOYEES[3].id, reviewer_id: andy.id, review_period: 'H1 2026', overall_rating: 5, strengths: 'Exceptional at employee relations, process improvement champion', areas_for_improvement: 'Could delegate more to build team capacity', goals: 'Implement new onboarding flow; reduce time-to-hire by 15%', status: 'completed', completed_at: '2026-07-03T14:00:00Z' },
        { employee_id: EMPLOYEES[4].id, reviewer_id: andy.id, review_period: 'H1 2026', overall_rating: 3, strengths: 'Good analytical skills, enthusiastic learner', areas_for_improvement: 'Still ramping up on company processes and tooling', goals: 'Complete all mandatory training; own the monthly variance report', status: 'in_progress' },
        { employee_id: andy.id, reviewer_id: EMPLOYEES[3].id, review_period: 'H1 2026', overall_rating: 5, strengths: 'Visionary leadership, strong technical judgment, excellent team builder', areas_for_improvement: 'Work-life balance — tendency to overcommit', goals: 'Delegate two standing responsibilities; take full leave allocation', status: 'completed', completed_at: '2026-07-05T09:00:00Z' },
      ])

      // Step 18: Onboarding
      addLog('Creating onboarding records...')
      await supabase.from('onboarding').insert([
        { user_action: 'Joiner', status: 'complete', firstname: 'Sarah', surname: 'Mitchell', start_date: '2023-03-15', user_email: 'sarah.mitchell@kumonix.com', job_title: 'Software Engineer', department: 'Engineering', employee_number: 'EMP002', manager: 'Andy Jones', manager_email: 'andy.jones@kumonix.com', contract_type: 'standard persona', location: 'London', company_id: COMPANY_ID },
        { user_action: 'Joiner', status: 'complete', firstname: 'James', surname: 'Patel', start_date: '2023-06-01', user_email: 'james.patel@kumonix.com', job_title: 'Product Designer', department: 'Design', employee_number: 'EMP003', manager: 'Andy Jones', manager_email: 'andy.jones@kumonix.com', contract_type: 'standard persona', location: 'London', company_id: COMPANY_ID },
        { user_action: 'Joiner', status: 'complete', firstname: 'Emma', surname: 'Chen', start_date: '2022-09-01', user_email: 'emma.chen@kumonix.com', job_title: 'HR Manager', department: 'HR', employee_number: 'EMP004', manager: 'Andy Jones', manager_email: 'andy.jones@kumonix.com', contract_type: 'standard persona', location: 'London', company_id: COMPANY_ID },
        { user_action: 'Joiner', status: 'in_progress', firstname: 'Tom', surname: 'Williams', start_date: '2024-01-08', user_email: 'tom.williams@kumonix.com', job_title: 'Finance Analyst', department: 'Finance', employee_number: 'EMP005', manager: 'Andy Jones', manager_email: 'andy.jones@kumonix.com', contract_type: 'standard persona', location: 'London', company_id: COMPANY_ID },
        { user_action: 'Joiner', status: 'new', firstname: 'Rachel', surname: 'Green', start_date: '2026-09-01', user_email: 'rachel.green@kumonix.com', job_title: 'Marketing Manager', department: 'Marketing', employee_number: 'EMP006', manager: 'Andy Jones', manager_email: 'andy.jones@kumonix.com', contract_type: 'standard persona', location: 'London', company_id: COMPANY_ID },
      ])

      // Step 19: Workflow tracker (pending actions for Andy)
      addLog('Creating workflow actions...')
      await supabase.from('workflow_tracker').insert([
        { emp_display_name: 'Sarah Mitchell', step: 1, status: 'Pending', record_type: 'Leave', action: 'Approve annual leave', employee_email: 'sarah.mitchell@kumonix.com', assigned_to: 'andy.jones@kumonix.com', task_description: 'Sarah Mitchell has requested 3 days annual leave (28-30 Jul 2026)', company_id: COMPANY_ID },
        { emp_display_name: 'James Patel', step: 1, status: 'Pending', record_type: 'Leave', action: 'Approve annual leave', employee_email: 'james.patel@kumonix.com', assigned_to: 'andy.jones@kumonix.com', task_description: 'James Patel has requested 5 days annual leave (1-5 Sep 2026)', company_id: COMPANY_ID },
        { emp_display_name: 'Tom Williams', step: 1, status: 'Pending', record_type: 'Leave', action: 'Approve annual leave', employee_email: 'tom.williams@kumonix.com', assigned_to: 'andy.jones@kumonix.com', task_description: 'Tom Williams has requested 2 days annual leave (18-19 Aug 2026)', company_id: COMPANY_ID },
        { emp_display_name: 'Sarah Mitchell', step: 1, status: 'Pending', record_type: 'Expense', action: 'Approve expense claim', employee_email: 'sarah.mitchell@kumonix.com', assigned_to: 'andy.jones@kumonix.com', task_description: 'Train to London office - £124.00', company_id: COMPANY_ID },
        { emp_display_name: 'James Patel', step: 1, status: 'Pending', record_type: 'Expense', action: 'Approve expense claim', employee_email: 'james.patel@kumonix.com', assigned_to: 'andy.jones@kumonix.com', task_description: 'Design software licence - £168.00', company_id: COMPANY_ID },
        { emp_display_name: 'Andy Jones', step: 1, status: 'Complete', record_type: 'Expense', action: 'Expense claim approved', employee_email: 'andy.jones@kumonix.com', assigned_to: 'andy.jones@kumonix.com', task_description: 'Client lunch meeting - £85.50', company_id: COMPANY_ID },
        { emp_display_name: 'Emma Chen', step: 1, status: 'Complete', record_type: 'Expense', action: 'Expense claim approved', employee_email: 'emma.chen@kumonix.com', assigned_to: 'andy.jones@kumonix.com', task_description: 'Team building dinner - £210.75', company_id: COMPANY_ID },
        { emp_display_name: 'Sarah Mitchell', step: 1, status: 'Complete', record_type: 'Leave', action: 'Sick leave approved', employee_email: 'sarah.mitchell@kumonix.com', assigned_to: 'andy.jones@kumonix.com', task_description: '2 days sick leave (16-17 Jun 2026)', company_id: COMPANY_ID },
      ])

      // Step 20: Notifications
      addLog('Creating notifications...')
      await supabase.from('notifications').insert([
        { employee_id: andy.id, title: 'Leave request pending', message: 'Sarah Mitchell has submitted a leave request for your approval', type: 'action', is_read: false, company_id: COMPANY_ID },
        { employee_id: andy.id, title: 'Expense claim pending', message: 'Sarah Mitchell submitted an expense claim (EXP-2026-002) for £124.00', type: 'action', is_read: false, company_id: COMPANY_ID },
        { employee_id: andy.id, title: 'New kudos received', message: 'Emma Chen sent you a kudos for mentoring new joiners', type: 'info', is_read: true, company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[1].id, title: 'Leave approved', message: 'Your sick leave (16-17 Jun) has been approved by Andy Jones', type: 'info', is_read: true, company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[1].id, title: 'New kudos received', message: 'Andy Jones sent you a kudos - great work on the API refactor!', type: 'info', is_read: false, company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[2].id, title: 'Mandatory training due', message: 'Cyber Security Awareness course is overdue - please complete ASAP', type: 'alert', is_read: false, company_id: COMPANY_ID },
        { employee_id: EMPLOYEES[4].id, title: 'Welcome to Kumonix!', message: 'Complete your onboarding checklist to get started', type: 'info', is_read: true, company_id: COMPANY_ID },
      ])

      // Step 21: App settings
      addLog('Setting app configuration...')
      await supabase.from('app_settings').upsert({
        id: 1, language: 'en', financial_year_start_month: 4, country_code: 'GB', company_id: COMPANY_ID,
      })

      // Step 22: User settings
      addLog('Creating user settings...')
      const defaultFeatures = JSON.stringify({ expenses: true, leave: true, profile: true, payslips: true, kudos: true, benefits: true, elearning: true, performance: true })
      await supabase.from('user_settings').insert(
        EMPLOYEES.map(e => ({
          employee_id: e.id,
          language: e.id === EMPLOYEES[2].id ? 'de' : 'en',
          features_config: defaultFeatures,
        }))
      )

      addLog('')
      addLog('Demo seed complete! Reload the page to see fresh data.')
      setDone(true)
    } catch (err: any) {
      addLog(`ERROR: ${err.message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Demo Seed Data</h2>
        <p>Reset all tables and populate with demo data for 5 employees</p>
      </div>

      <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <strong style={{ color: '#856404' }}>Warning:</strong>
        <span style={{ color: '#856404' }}> This will delete ALL existing data and replace it with demo data. Your admin login (andy.jones@kumonix.com) will be preserved.</span>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12 }}>What gets created:</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {[
            '1 Company (Kumonix)',
            '5 Employees',
            '5 Leave types + balances',
            '7 Leave requests',
            '5 Expense claims + 8 line items',
            '20 Payslips (4 months)',
            '6 Kudos entries',
            '4 Announcements',
            '5 Benefits + enrolments',
            '6 eLearning courses + 18 enrolments',
            '5 Performance reviews',
            '5 Onboarding records',
            '8 Workflow actions (5 pending)',
            '7 Notifications',
            'App & user settings',
          ].map(item => (
            <div key={item} style={{ padding: '8px 12px', background: '#f0f4f8', borderRadius: 6, fontSize: 13 }}>
              {item}
            </div>
          ))}
        </div>
      </div>

      <button
        className="admin-btn admin-btn-primary"
        onClick={runSeed}
        disabled={running}
        style={{ fontSize: 16, padding: '12px 32px' }}
      >
        {running ? 'Seeding...' : done ? 'Run Again' : 'Reset & Seed Demo Data'}
      </button>

      {log.length > 0 && (
        <div style={{ marginTop: 24, background: '#1e1e2e', borderRadius: 8, padding: 16, maxHeight: 400, overflowY: 'auto' }}>
          {log.map((line, i) => (
            <div key={i} style={{ fontFamily: 'monospace', fontSize: 13, color: line.startsWith('ERROR') ? '#f44336' : line === '' ? 'transparent' : line.includes('complete') ? '#4caf50' : '#cdd6f4', lineHeight: 1.6 }}>
              {line || '.'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
