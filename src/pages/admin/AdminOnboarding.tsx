import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase, callRpcDirect } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminCompany } from '../../context/AdminCompanyContext'
// v2: simplified mover workflow — removed update_persona step
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { useFeatures } from '../../context/FeatureContext'
import * as XLSX from 'xlsx'
import CompanySetupWizard from './CompanySetupWizard'
import { validateNINumber, validateSortCode, validateAccountNumber } from '../../lib/validators'
import { toLocalDateStr, currencySymbol } from '../../lib/formatters'
import { calculateLeaverFinancials as runLeaverCalc, type LeaverCalcInput, type LeaverCalcResult } from '../../lib/leaverCalculator'

const PAGE_SIZE = 30

interface OffboardRecord {
  id: number
  company_id: string
  employee_id: string
  employee_name: string
  employee_email: string
  job_title: string | null
  department: string | null
  end_date: string | null
  reason: string | null
  status: string
  workflow_steps: Record<string, boolean>
  skipped_steps: Record<string, boolean>
  is_complete: boolean
  frozen_at: string | null
  created_at: string
  data_export_url: string | null
  data_exported_at: string | null
  cleanup_bookings_done: boolean
  cleanup_shifts_done: boolean
  cleanup_benefits_done: boolean
  cleanup_assets_done: boolean
  custom_steps_completed: Record<string, boolean>
  notice_given_by: 'employee' | 'employer' | null
  notice_given_date: string | null
  leaver_calc_result: LeaverCalcResult | null
}

interface FrozenEmployee {
  id: number
  company_id: string
  employee_id: string
  employee_name: string
  employee_email: string
  frozen_at: string
  deletion_date: string
  status: string
  recovered_at: string | null
  extended_at: string | null
  extension_days: number
  data_export_url: string | null
  payroll_cleared: boolean
}

interface DeletionCertificate {
  id: string
  company_id: string
  employee_name: string
  employee_email: string
  employee_id: string
  leaving_date: string | null
  leaving_reason: string | null
  frozen_at: string | null
  deleted_at: string
  retention_days: number
  data_export_provided: boolean
  data_categories_held: string[]
  deletion_summary: Record<string, number>
  certificate_reference: string
  created_at: string
}

const STEP_TYPE_META: Record<string, { label: string; color: string; bg: string; icon: string; desc: string }> = {
  hr_action:        { label: 'HR Action',          color: '#7c3aed', bg: '#f5f3ff', icon: '☑️', desc: 'Manual task completed by ticking off' },
  email:            { label: 'Email',              color: '#0891b2', bg: '#ecfeff', icon: '✉️', desc: 'Sends a templated email, auto-completes on send' },
  app_notification: { label: 'App Notification',   color: '#ea580c', bg: '#fff7ed', icon: '🔔', desc: 'Creates an in-app notification, auto-completes' },
  meeting:          { label: 'Meeting',            color: '#059669', bg: '#ecfdf5', icon: '📅', desc: 'Schedules a meeting with attendees and duration' },
  elearning:        { label: 'E-Learning',         color: '#d97706', bg: '#fffbeb', icon: '📖', desc: 'Assigns training courses to complete' },
  approval:         { label: 'Approval',           color: '#dc2626', bg: '#fef2f2', icon: '✅', desc: 'Requires sign-off before workflow continues' },
  it_provisioning:  { label: 'IT / Provisioning',  color: '#6366f1', bg: '#eef2ff', icon: '💻', desc: 'IT tasks — accounts, equipment, access' },
  checklist:        { label: 'Checklist / To-Do',  color: '#64748b', bg: '#f8fafc', icon: '📋', desc: 'Simple tick-off item, no automation' },
  survey:           { label: 'Survey',             color: '#0d9488', bg: '#f0fdfa', icon: '📊', desc: 'Assigns a survey to the starter or leaver' },
  action:           { label: 'HR Action',          color: '#7c3aed', bg: '#f5f3ff', icon: '☑️', desc: 'Manual task completed by ticking off' },
  notice:           { label: 'App Notification',   color: '#ea580c', bg: '#fff7ed', icon: '🔔', desc: 'Creates an in-app notification, auto-completes' },
}

const OFFBOARD_STEPS = [
  { key: 'approve_resignation', label: 'Approve Resignation / Redundancy', icon: '📝', description: 'Review and formally approve the employee resignation or termination. Update HR records with the leaving reason and confirm final working date. Use the leaver financial calculator to work out holiday balance and costs.', role: 'HR', step_type: 'approval' as const },
  { key: 'recover_equipment', label: 'Recover Equipment', icon: '💻', description: 'Collect all company equipment — laptop, monitor, phone, building pass, keys, parking permit. Complete the asset return checklist and update the inventory register.', role: 'HR', step_type: 'it_provisioning' as const },
  { key: 'leaving_meeting', label: 'Organise Leaving Meeting', icon: '🤝', description: 'Schedule an exit interview and farewell meeting with the line manager. Cover handover tasks, knowledge transfer, and gather feedback on their experience.', role: 'Manager', step_type: 'meeting' as const },
  { key: 'convert_shared_mailbox', label: 'Convert to Shared Mailbox', icon: '📬', description: 'Convert the leaver\'s mailbox to a shared mailbox so colleagues can continue to access their emails without consuming a licence. This step can be skipped if not required.', role: 'HR', step_type: 'it_provisioning' as const },
  { key: 'forward_to_manager', label: 'Forward to Manager', icon: '📧', description: 'Set up email forwarding from the leaver\'s mailbox to their line manager so that incoming messages are not missed during the transition period. This step can be skipped if not required.', role: 'HR', step_type: 'it_provisioning' as const },
  { key: 'remove_accounts', label: 'Remove Accounts & Licences', icon: '🔐', description: 'Disable the Microsoft 365 account, revoke licence, remove from security groups and distribution lists. Archive mailbox if required.', role: 'HR', step_type: 'it_provisioning' as const },
  { key: 'review_shifts', label: 'Review Future Shifts', icon: '📅', description: 'Review and cancel any future shift assignments for this employee. Unassigned shifts can be reassigned to other team members via the rota.', role: 'HR', step_type: 'hr_action' as const },
  { key: 'review_bookings', label: 'Review Future Bookings', icon: '🏢', description: 'Review and cancel any future desk or room bookings made by this employee. This frees up the spaces for other team members.', role: 'HR', step_type: 'hr_action' as const },
  { key: 'review_benefits', label: 'Review Benefit Enrolments', icon: '🎁', description: 'Unenrol the employee from all active company benefits. If payroll is connected, benefit deductions will stop from the next pay run.', role: 'HR', step_type: 'hr_action' as const },
  { key: 'review_assets', label: 'Review Company Assets', icon: '📦', description: 'Confirm all company assets assigned to this employee have been accounted for and returned. Cross-reference with the asset register.', role: 'HR', step_type: 'hr_action' as const },
  { key: 'export_data', label: 'Export Employee Data (GDPR)', icon: '📥', description: 'Generate and download the GDPR data export pack containing all personal data held for this employee. This is also auto-generated when the account is frozen.', role: 'HR', step_type: 'checklist' as const },
  { key: 'reassign_reports', label: 'Reassign Direct Reports', icon: '👥', description: 'Reassign any employees who report to this person to a new manager. This also transfers all pending approval actions (leave, expenses, timesheets) to the new manager.', role: 'HR', step_type: 'hr_action' as const },
  { key: 'confirm_payments', label: 'Agree / Confirm Last Payments', icon: '💷', description: 'Calculate final salary payment including outstanding holiday pay, expenses, bonuses and any deductions. Confirm P45 will be issued and pension contributions ceased.', role: 'HR', step_type: 'approval' as const },
]

const MOVER_STEPS = [
  { key: 'review_changes', label: 'Review Proposed Changes', icon: '📋', description: 'Review all proposed changes including persona tier, role, department, location and manager. Confirm the changes are correct before proceeding.', role: 'HR', step_type: 'approval' as const },
  { key: 'update_accounts', label: 'Update M365 Account', icon: '🔐', description: 'Update the employee\'s Microsoft 365 account — this step sets extensionAttribute1 in Entra ID, swaps licences, and updates group membership. Dynamic groups re-evaluate automatically, applying the correct Intune profiles and conditional access policies.', role: 'HR', step_type: 'it_provisioning' as const },
  { key: 'update_records', label: 'Save Changes to InflowHR', icon: '📝', description: 'Apply the changes to the employee\'s InflowHR record — persona tier, job title, department, location and manager.', role: 'HR', step_type: 'hr_action' as const },
  { key: 'notify_team', label: 'Notify Team / Manager', icon: '📧', description: 'Inform the new and previous managers and team members of the role change. Share updated reporting lines and responsibilities.', role: 'HR', step_type: 'app_notification' as const },
  { key: 'review_access', label: 'Review Remaining Access', icon: '🔍', description: 'Review any access that requires manual attention — SharePoint sites, Teams channels, shared drives, and application permissions that were not automatically updated.', role: 'Manager', step_type: 'it_provisioning' as const },
  { key: 'confirm_complete', label: 'Confirm Complete', icon: '✅', description: 'Confirm all changes have been applied and verified. Mark the role change as complete.', role: 'HR', step_type: 'checklist' as const },
]

interface EnginePersona {
  id: string
  name: string
  description?: string
  ready?: boolean
  setup?: string
}

const LEGACY_PERSONA_MAP: Record<string, string> = {
  standard: 'information-worker',
  mobile: 'mobile-field-worker',
  strict_secure: 'secure-vip',
  kiosk: 'shared-kiosk',
}
function resolvePersonaId(raw: string): string { return LEGACY_PERSONA_MAP[raw] || raw }

const ENGINE_PERSONA_COLORS: Record<string, { color: string; bg: string }> = {
  'information-worker': { color: '#4f46e5', bg: '#eef2ff' },
  'mobile-field-worker': { color: '#0284c7', bg: '#e0f2fe' },
  'secure-vip': { color: '#dc2626', bg: '#fef2f2' },
  'shared-kiosk': { color: '#7c3aed', bg: '#ede9fe' },
}

const PERSONA_STATUS_DISPLAY: Record<string, { label: string; color: string; bg: string; border: string }> = {
  scheduled: { label: 'Scheduled', color: '#1976d2', bg: '#e3f2fd', border: '#90caf9' },
  pending_approval: { label: 'Waiting for Approval', color: '#f57f17', bg: '#fff8e1', border: '#ffe082' },
  blocked: { label: 'Action Required', color: '#c62828', bg: '#ffebee', border: '#ef9a9a' },
  running: { label: 'In Progress', color: '#1565c0', bg: '#e3f2fd', border: '#90caf9' },
  completed: { label: 'Complete', color: '#2e7d32', bg: '#e8f5e9', border: '#a5d6a7' },
  cancelled: { label: 'Cancelled', color: '#616161', bg: '#f5f5f5', border: '#e0e0e0' },
  missed: { label: 'Missed — needs rescheduling', color: '#e65100', bg: '#fff3e0', border: '#ffcc80' },
  failed: { label: 'Failed — contact IT', color: '#b71c1c', bg: '#ffebee', border: '#ef9a9a' },
  declined: { label: 'Declined', color: '#616161', bg: '#f5f5f5', border: '#e0e0e0' },
}

const PRECHECK_HELP: Record<string, { summary: string; action: string; detail: string }> = {
  account_has_admin_role: {
    summary: 'This employee has an admin account',
    action: 'Contact IT to make this change manually, or ask them to remove the admin role first so it can be done automatically.',
    detail: 'The engine cannot modify accounts with admin roles. IT can either remove the admin role and retry, or update extensionAttribute1 manually.\n\nNote: extensionAttribute1 is not visible in the Entra ID portal user interface.\n\nTo VIEW the current value, IT can use:\n• Microsoft Graph Explorer — GET https://graph.microsoft.com/v1.0/users/{email}?$select=onPremisesExtensionAttributes\n• PowerShell — Get-MgUser -UserId {email} -Property OnPremisesExtensionAttributes | Select -ExpandProperty OnPremisesExtensionAttributes\n\nTo CHANGE the value, IT can use:\n• Graph Explorer — PATCH https://graph.microsoft.com/v1.0/users/{email} with body {"onPremisesExtensionAttributes":{"extensionAttribute1":"target-persona-id"}}\n• PowerShell — Update-MgUser -UserId {email} -OnPremisesExtensionAttributes @{extensionAttribute1="target-persona-id"}\n\nReplace {email} with the employee\'s email and "target-persona-id" with the persona ID shown below.',
  },
  admin_move_needs_approval: {
    summary: 'Extra approval needed',
    action: 'A Global Admin needs to approve this change before it can go ahead. Contact your IT team.',
    detail: 'Admin account persona changes require Global Admin approval via InflowOnboarder.',
  },
  persona_not_set_up: {
    summary: 'Persona not configured yet',
    action: 'Ask IT to set up this persona in InflowOnboarder before you can assign it.',
    detail: 'The target persona template is not configured in InflowOnboarder Settings → Templates.',
  },
  persona_group_not_found: {
    summary: 'Missing security group',
    action: 'Ask IT to create the required security groups for this persona.',
    detail: 'One or more Entra ID security groups for this persona do not exist. IT needs to create them or update the persona template.',
  },
  account_protected: {
    summary: 'Protected account',
    action: 'This account is protected. Contact IT to make this change manually.',
    detail: 'The account has protection rules that prevent automatic modification.',
  },
  user_not_found: {
    summary: 'Account not found',
    action: 'Check the employee\'s email address is correct. If it is, ask IT to verify the account exists.',
    detail: 'The user account was not found in Microsoft 365 / Entra ID.',
  },
  licence_unavailable: {
    summary: 'No licences available',
    action: 'Ask IT to purchase or free up licences for this persona, then try again.',
    detail: 'The M365 licence required for the target persona has no available seats.',
  },
}

interface RoleChange {
  id: number
  company_id: string
  employee_id: string
  employee_name: string
  employee_email: string
  change_type: string
  changes: any
  effective_date: string | null
  status: string
  workflow_steps: Record<string, boolean>
  skipped_steps: Record<string, boolean>
  is_complete: boolean
  requested_by: string | null
  reason: string | null
  created_at: string
  completed_at: string | null
}

interface SyncRecord {
  id: number
  company_id: string
  kind: string
  action: string
  record_id: number
  schedule_id: string | null
  external_ref: string
  status: string
  attempts: number
  last_attempt_at: string | null
  last_error: string | null
  next_retry_at: string | null
  source: string
  created_at: string
  completed_at: string | null
  reviewed_by: string | null
  review_note: string | null
}

interface MoverM365Actions {
  id: string
  role_change_id: number
  company_id: string
  run_id: string | null
  run_status: string | null
  run_error: any
  run_result: any
  approval_sent_at: string | null
  approval_status: string | null
  approved_by: string | null
  approved_at: string | null
  schedule_id: string | null
  schedule_status: string | null
  schedule_message: string | null
  schedule_stages: any
  schedule_next_due_at: string | null
  schedule_updated_at: string | null
  schedule_options: any
  employee_upn: string | null
  attempt_count_run: number
  persona_check_result: any
  persona_schedule_id: string | null
  persona_schedule_status: string | null
  persona_pre_check: any
  persona_next_actions: string[] | null
  persona_schedule_message: string | null
  persona_schedule_stages: any
  persona_schedule_next_due_at: string | null
  persona_schedule_updated_at: string | null
  external_ref: string | null
  persona_external_ref: string | null
  decline_reason: string | null
  declined_by: string | null
  declined_at: string | null
  created_at: string
  updated_at: string
}

interface OnboardRecord {
  id: number
  company_id: string
  company?: { name: string } | null
  firstname: string
  surname: string
  user_email: string
  job_title: string
  department: string
  start_date: string
  status: string
  manager: string
  manager_email: string
  personal_email: string
  location: string
  telephone: string
  employee_number: string
  contract_type: string
  employment_category: string | null
  equipment_order: string
  is_complete: boolean
  first_day: boolean
  first_week: boolean
  first_month: boolean
  elearning: boolean
  created_at: string
  date_of_birth: string | null
  gender: string | null
  nationality: string | null
  marital_status: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  county: string | null
  postcode: string | null
  country: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relationship: string | null
  ni_number: string | null
  bank_sort_code: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  probation_end_date: string | null
  notice_period: string | null
  weekly_hours: number | null
  annual_salary: number | null
  tax_code: string | null
  payroll_id: string | null
  leave_allowance: number | null
  skipped_steps: Record<string, boolean> | null
  custom_steps_completed: Record<string, boolean> | null
}

const WORKFLOW_STEPS = [
  { key: 'details', label: 'Create Starter Details', icon: '📋', description: 'Capture personal information, role details, start date and contract type for the new employee.', step_type: 'hr_action' as const },
  { key: 'equipment', label: 'Order Equipment', icon: '💻', description: 'Raise equipment requests — laptop, monitor, keyboard, headset, building pass. Select device type and delivery address.', step_type: 'it_provisioning' as const },
  { key: 'meeting', label: 'Organise First Meeting', icon: '🤝', description: 'Schedule welcome meeting with manager. Send calendar invite and prepare agenda covering first week expectations.', step_type: 'meeting' as const },
  { key: 'notify_manager', label: 'Notify Manager', icon: '📧', description: 'Inform the line manager of confirmed start date, equipment status and onboarding checklist. Share new starter profile.', step_type: 'app_notification' as const },
  { key: 'plan_day1', label: 'Plan First Day', icon: '📅', description: 'Prepare day-one schedule: building access, desk assignment, welcome pack, team introductions and lunch arrangements.', step_type: 'hr_action' as const },
  { key: 'inform_starter', label: 'Inform Starter', icon: '✉️', description: 'Send welcome email to the new starter with start date, office location, dress code, parking info and first day schedule.', step_type: 'email' as const },
  { key: 'assign_elearning', label: 'Assign New Starter E-Learning', icon: '📚', description: 'Assign the company new starter e-learning course. 7-day completion deadline from start date, appears in employee reminders.', step_type: 'elearning' as const },
  { key: 'accounts', label: 'Create Accounts & Licences', icon: '🔐', description: 'Create the new starter\'s Microsoft 365 account via InflowOnboarder — checks licence availability, creates the account, assigns the licence and adds to groups. Generates a temporary password.', step_type: 'it_provisioning' as const },
  { key: 'day1_access', label: 'Day 1 Access Verification', icon: '✅', description: 'Confirm the new starter can log in, access email, Teams, shared drives and all required business applications on their first day.', step_type: 'checklist' as const },
]

export default function AdminOnboarding() {
  const { isSuperAdmin, company, session } = useAuth()
  const currency = company?.currency || 'GBP'
  const { selectedCompanyId, selectedCompany, refreshCompanies } = useAdminCompany()
  const { fyStartMonth } = useLanguage()
  const { showError, showSuccess, showWarning } = useToast()
  const { features } = useFeatures()
  const location = useLocation()
  const [records, setRecords] = useState<OnboardRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'dashboard' | 'new' | 'list' | 'workflow' | 'upload' | 'setup' | 'offboarding' | 'offboard-workflow' | 'movers' | 'mover-workflow' | 'settings' | 'jml'>('dashboard')
  const [jmlSection, setJmlSection] = useState<'joiners' | 'movers' | 'leavers'>('joiners')
  const [filterStatus, setFilterStatus] = useState('')
  const [onbPage, setOnbPage] = useState(1)
  const [offPage, setOffPage] = useState(1)
  const [frozenPage, setFrozenPage] = useState(1)
  const [complPage, setComplPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [workflowStep, setWorkflowStep] = useState(0)
  const [stepChecks, setStepChecks] = useState<Record<string, boolean>>({})
  const [stepSkips, setStepSkips] = useState<Record<string, boolean>>({})
  const [newForm, setNewForm] = useState<Record<string, string>>({
    firstname: '', surname: '', user_email: '', job_title: '', department: '',
    start_date: '', manager: '', manager_email: '', personal_email: '',
    location: '', telephone: '', employee_number: '', contract_type: 'Full-time', employment_category: 'employed',
    date_of_birth: '', gender: '', nationality: '', marital_status: '',
    address_line1: '', address_line2: '', city: '', county: '', postcode: '', country: 'United Kingdom',
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
    ni_number: '', bank_sort_code: '', bank_account_number: '', bank_account_name: '',
    probation_end_date: '', notice_period: '', weekly_hours: '37.5',
    annual_salary: '', tax_code: '', payroll_id: '', religion: '', salary_group: 'N/A', qualifications: '',
    user_persona: 'information-worker',
  })

  const [offboardRecords, setOffboardRecords] = useState<OffboardRecord[]>([])
  const [frozenEmployees, setFrozenEmployees] = useState<FrozenEmployee[]>([])
  const [offboardSelectedId, setOffboardSelectedId] = useState<number | null>(null)
  const [offboardStep, setOffboardStep] = useState(0)
  const [offboardChecks, setOffboardChecks] = useState<Record<string, boolean>>({})
  const [offboardSkips, setOffboardSkips] = useState<Record<string, boolean>>({})
  const [showFreezeModal, setShowFreezeModal] = useState<OffboardRecord | null>(null)
  const [reassignData, setReassignData] = useState<{ directReports: { id: string; first_name: string; last_name: string; email: string }[]; pendingActions: number } | null>(null)
  const [reassignTargetId, setReassignTargetId] = useState('')
  const [reassignCandidates, setReassignCandidates] = useState<{ id: string; first_name: string; last_name: string; email: string }[]>([])
  const [reassignSaving, setReassignSaving] = useState(false)
  const [offboardEmployeeSearch, setOffboardEmployeeSearch] = useState('')
  const [offboardEmployeeResults, setOffboardEmployeeResults] = useState<{ id: string; first_name: string; last_name: string; email: string; job_title: string; department: string }[]>([])
  const [offboardForm, setOffboardForm] = useState({ end_date: '', reason: '' })
  const [expandedCompletedId, setExpandedCompletedId] = useState<number | null>(null)
  const [timingWarningStep, setTimingWarningStep] = useState<string | null>(null)

  // Leaver financial calculator
  const [leaverCalcLoading, setLeaverCalcLoading] = useState(false)
  const [leaverCalcResult, setLeaverCalcResult] = useState<LeaverCalcResult | null>(null)
  const [leaverCalcError, setLeaverCalcError] = useState('')

  // Leaver review step data
  const [reviewShifts, setReviewShifts] = useState<{ id: number; date: string; shift_name: string; rota_name: string }[]>([])
  const [reviewBookings, setReviewBookings] = useState<{ id: number; booking_date: string; space_name: string }[]>([])
  const [reviewBenefits, setReviewBenefits] = useState<{ id: number; benefit_name: string; enrolled_at: string }[]>([])
  const [reviewAssets, setReviewAssets] = useState<{ id: number; asset_name: string; asset_type: string; assigned_date: string }[]>([])
  const [deletionCertificates, setDeletionCertificates] = useState<DeletionCertificate[]>([])

  // Custom offboarding steps state
  const [offboardCustomSteps, setOffboardCustomSteps] = useState<CustomStep[]>([])
  const [offboardEditingSteps, setOffboardEditingSteps] = useState<CustomStep[]>([])
  const [hasOffboardCustomSteps, setHasOffboardCustomSteps] = useState(false)
  const [settingsWorkflowType, setSettingsWorkflowType] = useState<'onboarding' | 'offboarding'>('onboarding')

  // Movers state
  const [moverRecords, setMoverRecords] = useState<RoleChange[]>([])
  const [moverM365, setMoverM365] = useState<Record<number, MoverM365Actions>>({})
  const [moverSelectedId, setMoverSelectedId] = useState<number | null>(null)
  const [moverStep, setMoverStep] = useState(0)
  const [moverChecks, setMoverChecks] = useState<Record<string, boolean>>({})
  const [moverSkips, setMoverSkips] = useState<Record<string, boolean>>({})
  const [moverPage, setMoverPage] = useState(1)
  const [moverEmployeeSearch, setMoverEmployeeSearch] = useState('')
  const [moverEmployeeResults, setMoverEmployeeResults] = useState<{ id: string; first_name: string; last_name: string; email: string; job_title: string; department: string; location: string; manager_name: string; manager_email: string; persona: string }[]>([])
  const [moverForm, setMoverForm] = useState<Record<string, any>>({})
  const [moverSelectedEmployee, setMoverSelectedEmployee] = useState<any>(null)
  const [expandedMoverCompletedId, setExpandedMoverCompletedId] = useState<number | null>(null)
  const [expandedMoverDeclineId, setExpandedMoverDeclineId] = useState<number | null>(null)
  const [enginePersonas, setEnginePersonas] = useState<EnginePersona[]>([])
  const [enginePersonasLoaded, setEnginePersonasLoaded] = useState(false)

  // Engine schedule sync state
  const [syncRecords, setSyncRecords] = useState<SyncRecord[]>([])
  const [syncExpanded, setSyncExpanded] = useState(false)
  const [syncDismissNote, setSyncDismissNote] = useState<Record<number, string>>({})

  const [moverApproverConfig, setMoverApproverConfig] = useState<{ mode: string; name?: string; email?: string; joiner_approver_mode?: string; joiner_approver_name?: string; joiner_approver_email?: string }>({ mode: 'same_as_joiner' })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadRows, setUploadRows] = useState<Record<string, string>[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ success: number; failed: number } | null>(null)

  // Custom workflow steps state
  interface StepConfig {
    step_type?: 'hr_action' | 'email' | 'app_notification' | 'meeting' | 'elearning' | 'approval' | 'it_provisioning' | 'checklist' | 'survey' | 'action' | 'notice'
    survey_id?: string
    assignee_role?: 'hr_admin' | 'line_manager' | 'it_contact' | 'starter_leaver' | 'finance' | 'custom'
    relative_due_days?: number
    relative_due_anchor?: 'start_date' | 'leave_date' | 'effective_date'
    notify_email?: string
    notify_contact_key?: string
    notify_starter?: boolean
    notify_subject?: string
    notify_body?: string
    requires_step?: string
    meeting?: { title?: string; body?: string; attendees?: string[]; duration_minutes?: number }
    phase?: 'preparation' | 'post_join'
  }
  interface CustomStep { id?: number; step_key: string; label: string; icon: string; description: string; sort_order: number; is_default: boolean; step_config?: StepConfig }
  interface CompanyContact { id?: number; contact_key: string; label: string; email: string; phone?: string; notes?: string; sort_order: number }
  const [customSteps, setCustomSteps] = useState<CustomStep[]>([])
  const [editingSteps, setEditingSteps] = useState<CustomStep[]>([])
  const [hasCustomSteps, setHasCustomSteps] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [companyContacts, setCompanyContacts] = useState<CompanyContact[]>([])
  const [editingContacts, setEditingContacts] = useState<CompanyContact[]>([])
  const [contactsDirty, setContactsDirty] = useState(false)
  const [contactsSaving, setContactsSaving] = useState(false)
  const [settingsSubTab, setSettingsSubTab] = useState<'workflows' | 'contacts' | 'guide'>('workflows')
  const [stepNotifSending, setStepNotifSending] = useState<string | null>(null)
  const [companySurveys, setCompanySurveys] = useState<{ id: string; title: string }[]>([])
  const [surveyAssigning, setSurveyAssigning] = useState<string | null>(null)

  // Workflow detail panel state
  interface ChecklistItem { id: number; step_key: string; label: string; sort_order: number }
  interface ActivityEntry { id: number; step_key: string; action: string; actor_name: string | null; detail: string | null; created_at: string }
  const [stepChecklist, setStepChecklist] = useState<ChecklistItem[]>([])
  const [stepChecklistCompleted, setStepChecklistCompleted] = useState<Record<string, Record<number, boolean>>>({})
  const [stepAssignments, setStepAssignments] = useState<Record<string, { assigned_to?: string; due_date?: string }>>({})
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([])
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({})
  const [reassignStepKey, setReassignStepKey] = useState<string | null>(null)
  const [reassignStepEmail, setReassignStepEmail] = useState('')

  const activeSteps: CustomStep[] = hasCustomSteps ? customSteps : WORKFLOW_STEPS.map((s, i) => ({ step_key: s.key, label: s.label, icon: s.icon, description: s.description, sort_order: i, is_default: true, step_config: { step_type: s.step_type } as StepConfig }))

  // M365 provisioning state (InflowOnboarder v2)
  interface M365Actions {
    onboarding_id: number
    run_id: string | null
    run_status: string | null
    run_error: any
    run_result: any
    m365_user_id: string | null
    m365_upn: string | null
    approval_sent_at: string | null
    approval_status: string | null
    approved_by: string | null
    approved_at: string | null
    attempt_count_run: number
    is_v1_legacy: boolean
    create_account_status: string | null
    create_account_job_id: string | null
    licence_status: string | null
    licence_sku_id: string | null
    schedule_id: string | null
    schedule_status: string | null
    schedule_message: string | null
    schedule_stages: any[] | null
    schedule_next_due_at: string | null
    schedule_options: any | null
    pass_id: string | null
    pass_expires_at: string | null
    pass_viewed_at: string | null
    pass_viewed_by: string | null
    pass_status: string | null
  }
  interface IfoSettings {
    approver_mode: 'manager' | 'nominated'
    approver_name: string | null
    approver_email: string | null
    account_domain: string | null
    licence_sku_id: string | null
    licence_sku_name: string | null
    licence_manager_name: string | null
    group_name: string | null
    passes_enabled: boolean
    passes_ready: boolean
    passes_status_detail: string | null
    passes_available: boolean
    functions_cache: Record<string, { enabled: boolean; suspended: boolean; suspendedReason?: string; inPlan: boolean; available?: boolean }> | null
  }
  const [m365Actions, setM365Actions] = useState<M365Actions | null>(null)
  const [m365Upn, setM365Upn] = useState('')
  const [m365DisplayName, setM365DisplayName] = useState('')
  const [m365Location, setM365Location] = useState('GB')
  const [m365RunPolling, setM365RunPolling] = useState(false)
  const [m365Starting, setM365Starting] = useState(false)
  const [m365ApprovalSending, setM365ApprovalSending] = useState(false)
  const [m365Proceeding, setM365Proceeding] = useState(false)
  const [ifoConnected, setIfoConnected] = useState(false)
  const [ifoSettings, setIfoSettings] = useState<IfoSettings | null>(null)
  const [m365ScheduleMode, setM365ScheduleMode] = useState<'now' | 'schedule'>('now')
  const [m365SchedulingAvailable, setM365SchedulingAvailable] = useState(false)
  const [m365PrepareDays, setM365PrepareDays] = useState(3)
  const [m365PrepareDate, setM365PrepareDate] = useState('')
  const [m365ScheduleCreating, setM365ScheduleCreating] = useState(false)
  const [m365IssuePass, setM365IssuePass] = useState(true)
  const [tapRevealConfirmOpen, setTapRevealConfirmOpen] = useState(false)
  const [tapRevealData, setTapRevealData] = useState<{ pass: string; upn: string; expiresAt: string; oneTimeUse: boolean; notice: string } | null>(null)
  const [tapRevealing, setTapRevealing] = useState(false)
  const [tapRequesting, setTapRequesting] = useState(false)
  const [tapJobPolling, setTapJobPolling] = useState(false)
  const [m365ScheduleCancelling, setM365ScheduleCancelling] = useState(false)
  const [m365ScheduleRefreshing, setM365ScheduleRefreshing] = useState(false)
  const [m365ActiveProvisionCount, setM365ActiveProvisionCount] = useState(0)

  // Identity provider gating
  const [identityProvider, setIdentityProvider] = useState<'entra' | 'google_workspace'>('entra')
  const [skipLicence, setSkipLicence] = useState(false)
  const [newStarterCourseInfo, setNewStarterCourseInfo] = useState<{ enabled: boolean, course: { title: string, type: string, duration: string, days_to_complete: number | null } | null } | null>(null)

  const COLUMN_MAP: Record<string, string> = {
    'first name': 'firstname', 'surname': 'surname', 'work email': 'user_email',
    'personal email': 'personal_email', 'job title': 'job_title', 'department': 'department',
    'manager name': 'manager', 'manager email': 'manager_email', 'location': 'location',
    'phone': 'telephone', 'employee number': 'employee_number', 'start date': 'start_date',
    'contract type': 'contract_type', 'date of birth': 'date_of_birth', 'gender': 'gender',
    'nationality': 'nationality', 'marital status': 'marital_status',
    'address line 1': 'address_line1', 'address line 2': 'address_line2',
    'city': 'city', 'county': 'county', 'postcode': 'postcode', 'country': 'country',
    'emergency contact name': 'emergency_contact_name', 'emergency contact phone': 'emergency_contact_phone',
    'emergency contact relationship': 'emergency_contact_relationship',
    'ni number': 'ni_number', 'bank sort code': 'bank_sort_code',
    'bank account number': 'bank_account_number', 'bank account name': 'bank_account_name',
    'probation end date': 'probation_end_date', 'notice period': 'notice_period',
    'weekly hours': 'weekly_hours',
    'annual salary': 'annual_salary', 'tax code': 'tax_code', 'payroll id': 'payroll_id',
    'leave allowance': 'leave_allowance', 'assigned leave days': 'leave_allowance',
    'religion': 'religion', 'salary group': 'salary_group', 'qualifications': 'qualifications',
    'xero employee id': 'xero_employee_id',
    'employment category': 'employment_category', 'worker type': 'employment_category',
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadErrors([])
    setUploadResult(null)

    const reader = new FileReader()
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target!.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      if (raw.length === 0) {
        setUploadErrors(['The spreadsheet is empty or has no data rows.'])
        return
      }

      const errors: string[] = []
      const mapped = raw.map((row, i) => {
        const out: Record<string, string> = { contract_type: 'Full-time' }
        for (const [excelCol, val] of Object.entries(row)) {
          const key = COLUMN_MAP[excelCol.toLowerCase().trim()]
          if (key) {
            let strVal = String(val).trim()
            const dateFields = ['start_date', 'date_of_birth', 'probation_end_date']
            if (dateFields.includes(key) && typeof val === 'number') {
              const d = XLSX.SSF.parse_date_code(val)
              strVal = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
            } else if (dateFields.includes(key) && typeof val === 'string') {
              const ddmmyyyy = strVal.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
              if (ddmmyyyy) strVal = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`
            }
            out[key] = strVal
          }
        }
        if (!out.firstname) errors.push(`Row ${i + 2}: Missing First Name`)
        if (!out.surname) errors.push(`Row ${i + 2}: Missing Surname`)
        if (isNonSso) {
          if (!out.employee_number) errors.push(`Row ${i + 2}: Missing Employee Number (required for Non-SSO)`)
        } else {
          if (!out.user_email) errors.push(`Row ${i + 2}: Missing Work Email`)
          else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.user_email))
            errors.push(`Row ${i + 2}: Invalid email "${out.user_email}"`)
        }
        return out
      })

      setUploadErrors(errors)
      setUploadRows(mapped)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  async function submitUpload() {
    if (uploadErrors.length > 0 || uploadRows.length === 0 || !selectedCompanyId) return
    const piiErrors: string[] = []
    uploadRows.forEach((row, i) => {
      const ni = validateNINumber(row.ni_number || '')
      const sc = validateSortCode(row.bank_sort_code || '')
      const ac = validateAccountNumber(row.bank_account_number || '')
      const rowErrs = [ni, sc, ac].filter(Boolean)
      if (rowErrs.length) piiErrors.push(`Row ${i + 1}: ${rowErrs.join(', ')}`)
    })
    if (piiErrors.length > 0) { showError(piiErrors.slice(0, 5).join(' | ')); return }
    setUploading(true)
    let success = 0, failed = 0

    await callRpcDirect('ensure_super_admin_access', { p_hours: 48 })

    const toInsert = uploadRows.map(row => {
      const s = sanitisePayload(row)
      return { ...s, status: 'new', is_complete: false, company_id: selectedCompanyId }
    })
    const { error } = await supabase.from('onboarding').insert(toInsert)
    if (error) { failed = uploadRows.length; showError('Bulk upload failed: ' + error.message) }
    else { success = uploadRows.length; showSuccess(`${success} starter${success !== 1 ? 's' : ''} created`) }

    setUploadResult({ success, failed })
    setUploading(false)
    if (success > 0) load()
  }

  function clearUpload() {
    setUploadRows([])
    setUploadErrors([])
    setUploadResult(null)
  }

  function generateBulkTemplate() {
    const headers = ['First Name', 'Surname', 'Work Email', 'Personal Email', 'Job Title', 'Department', 'Manager Name', 'Manager Email', 'Location', 'Phone', 'Employee Number', 'Start Date', 'Contract Type', 'Date of Birth', 'Gender', 'Nationality', 'Marital Status', 'Religion', 'NI Number', 'Address Line 1', 'Address Line 2', 'City', 'County', 'Postcode', 'Country', 'Working Pattern', 'Weekly Hours', 'Probation End Date', 'Notice Period', 'Annual Salary', 'Salary Group', 'Tax Code', 'Payroll ID', 'Xero Employee ID', 'Leave Allowance', 'Qualifications', 'Emergency Contact Name', 'Emergency Contact Phone', 'Emergency Contact Relationship', 'Bank Account Name', 'Bank Sort Code', 'Bank Account Number']
    const ws = XLSX.utils.aoa_to_sheet([headers])
    ws['!cols'] = headers.map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'New Starters')
    XLSX.writeFile(wb, 'new-starter-template.xlsx')
  }

  useEffect(() => {
    if (selectedCompanyId) {
      setRecords([])
      setOffboardRecords([])
      setFrozenEmployees([])
      load()
      loadOffboarding()
      loadMovers()
      loadCustomSteps()
      loadOffboardCustomSteps()
      loadCompanyContacts()
      loadSyncStatus()
      supabase.from('company_surveys').select('id, title').eq('company_id', selectedCompanyId).then(({ data }) => { if (data) setCompanySurveys(data) })
      // Load identity provider settings
      supabase.from('companies').select('identity_provider, skip_licence_assignment').eq('id', selectedCompanyId).maybeSingle().then(({ data }) => {
        if (data) {
          setIdentityProvider((data.identity_provider as 'entra' | 'google_workspace') || 'entra')
          setSkipLicence(!!data.skip_licence_assignment)
        }
      })
    }
  }, [selectedCompanyId])

  useEffect(() => {
    setOnbPage(1)
    setOffPage(1)
    setFrozenPage(1)
    setComplPage(1)
  }, [filterStatus, selectedCompanyId])

  useEffect(() => {
    const state = location.state as any
    if (state?.tab === 'jml') {
      setTab('jml')
      if (state.jmlSection) setJmlSection(state.jmlSection)
      if (state.prefill) {
        const pf = state.prefill
        setMoverSelectedEmployee({ id: pf.empId, first_name: pf.empName.split(' ')[0], last_name: pf.empName.split(' ').slice(1).join(' '), email: pf.empEmail, work_email: pf.empEmail, job_title: '', department: '', location: '', manager_name: '', manager_email: '', persona: resolvePersonaId(pf.personaChange.old), has_company_device: true })
        setMoverEmployeeSearch(pf.empName)
        setMoverForm({ employee_id: pf.empId, employee_name: pf.empName, employee_email: pf.empEmail, changes: { persona: { old: resolvePersonaId(pf.personaChange.old), new: resolvePersonaId(pf.personaChange.new) } }, change_type: 'persona_change', reason: '', additionalFields: [] })
      }
      window.history.replaceState({}, '')
    }
  }, [location.state])

  // Load new starter course info when the assign_elearning step is current
  useEffect(() => {
    if (!selectedCompanyId) return
    const currentStep = activeSteps[workflowStep]
    if (currentStep?.step_key !== 'assign_elearning') { setNewStarterCourseInfo(null); return }
    ;(async () => {
      const { data: companyData } = await supabase.from('companies')
        .select('new_starter_elearning_enabled, new_starter_course_id')
        .eq('id', selectedCompanyId).single()
      if (!companyData) { setNewStarterCourseInfo(null); return }
      if (companyData.new_starter_course_id) {
        const { data: courseData } = await supabase.from('elearning_courses')
          .select('title, type, duration, days_to_complete')
          .eq('id', companyData.new_starter_course_id).maybeSingle()
        setNewStarterCourseInfo({ enabled: !!companyData.new_starter_elearning_enabled, course: courseData || null })
      } else {
        setNewStarterCourseInfo({ enabled: !!companyData.new_starter_elearning_enabled, course: null })
      }
    })()
  }, [selectedCompanyId, workflowStep, activeSteps])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('onboarding').select('*, company:companies(name)').eq('company_id', selectedCompanyId).order('created_at', { ascending: false })
    setRecords((data as OnboardRecord[]) || [])
    setLoading(false)
  }

  async function loadOffboarding() {
    const [{ data: offData }, { data: frozenData }, { data: certData }] = await Promise.all([
      supabase.from('offboarding').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false }),
      supabase.from('frozen_employees').select('*').eq('company_id', selectedCompanyId).order('frozen_at', { ascending: false }),
      supabase.from('deletion_certificates').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false }),
    ])
    setOffboardRecords((offData as OffboardRecord[]) || [])
    setFrozenEmployees((frozenData as FrozenEmployee[]) || [])
    setDeletionCertificates((certData as DeletionCertificate[]) || [])
  }

  async function loadMovers() {
    const [{ data: rcData }, { data: m365Data }, { data: ifo }] = await Promise.all([
      supabase.from('role_changes').select('*').eq('company_id', selectedCompanyId).order('created_at', { ascending: false }),
      supabase.from('mover_m365_actions').select('*').eq('company_id', selectedCompanyId),
      supabase.from('inflowonboarder_integrations').select('status, mover_approver_mode, mover_approver_name, mover_approver_email, approver_mode, approver_name, approver_email').eq('company_id', selectedCompanyId).maybeSingle(),
    ])
    const connected = ifo?.status === 'connected_ready'
    setIfoConnected(connected)
    if (ifo) setMoverApproverConfig({ mode: ifo.mover_approver_mode || 'same_as_joiner', name: ifo.mover_approver_name, email: ifo.mover_approver_email, joiner_approver_mode: ifo.approver_mode, joiner_approver_name: ifo.approver_name, joiner_approver_email: ifo.approver_email })
    setMoverRecords((rcData as RoleChange[]) || [])
    const m365Map: Record<number, MoverM365Actions> = {}
    ;(m365Data || []).forEach((r: any) => { m365Map[r.role_change_id] = r })
    setMoverM365(m365Map)
    if (connected && !enginePersonasLoaded) {
      try {
        const raw = await callIfoMover('list-personas', {})
        if (raw) {
          const list = raw.personas || raw.items || (Array.isArray(raw) ? raw : [])
          setEnginePersonas(Array.isArray(list) ? list : [])
          setEnginePersonasLoaded(true)
        }
      } catch { /* engine unavailable — personas stay empty */ }
    }
  }

  async function loadReviewData(employeeId: string) {
    const today = new Date().toISOString().split('T')[0]
    const [{ data: shifts }, { data: bookings }, { data: benefits }, { data: assets }] = await Promise.all([
      supabase.from('shift_assignments').select('id, date, shift_name, rota:rotas(name)').eq('employee_id', employeeId).gte('date', today),
      supabase.from('space_bookings').select('id, booking_date, space:spaces(name)').eq('employee_id', employeeId).gte('booking_date', today).neq('status', 'cancelled'),
      supabase.from('employee_benefits').select('id, benefit:benefits(name), enrolled_at').eq('employee_id', employeeId).is('unenrolled_at', null),
      supabase.from('company_assets').select('id, name, type, assigned_date').eq('assigned_to', employeeId),
    ])
    setReviewShifts((shifts || []).map((s: any) => ({ id: s.id, date: s.date, shift_name: s.shift_name || 'Shift', rota_name: s.rota?.name || '' })))
    setReviewBookings((bookings || []).map((b: any) => ({ id: b.id, booking_date: b.booking_date, space_name: b.space?.name || 'Space' })))
    setReviewBenefits((benefits || []).map((b: any) => ({ id: b.id, benefit_name: b.benefit?.name || 'Benefit', enrolled_at: b.enrolled_at })))
    setReviewAssets((assets || []).map((a: any) => ({ id: a.id, asset_name: a.name || 'Asset', asset_type: a.type || '', assigned_date: a.assigned_date || '' })))
  }

  async function loadOffboardCustomSteps() {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('offboard_workflow_steps')
      .select('*').eq('company_id', selectedCompanyId).order('sort_order')
    if (data && data.length > 0) {
      setOffboardCustomSteps(data)
      setHasOffboardCustomSteps(true)
    } else {
      setOffboardCustomSteps([])
      setHasOffboardCustomSteps(false)
    }
  }

  async function loadCustomSteps() {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('onboard_workflow_steps')
      .select('*').eq('company_id', selectedCompanyId).order('sort_order')
    if (data && data.length > 0) {
      setCustomSteps(data)
      setHasCustomSteps(true)
    } else {
      setCustomSteps([])
      setHasCustomSteps(false)
    }
  }

  const DEFAULT_CONTACTS: CompanyContact[] = [
    { contact_key: 'it_admin', label: 'IT Admin', email: '', sort_order: 0 },
    { contact_key: 'support', label: 'Support', email: '', sort_order: 1 },
    { contact_key: 'facilities', label: 'Facilities', email: '', sort_order: 2 },
    { contact_key: 'security', label: 'Security', email: '', sort_order: 3 },
  ]

  async function loadCompanyContacts() {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('company_contacts')
      .select('*').eq('company_id', selectedCompanyId).order('sort_order')
    if (data && data.length > 0) {
      setCompanyContacts(data as CompanyContact[])
    } else {
      setCompanyContacts([])
    }
  }

  async function saveCompanyContacts() {
    if (!selectedCompanyId) return
    setContactsSaving(true)
    try {
      await supabase.from('company_contacts').delete().eq('company_id', selectedCompanyId)
      const rows = editingContacts.filter(c => c.label.trim()).map((c, i) => ({
        company_id: selectedCompanyId,
        contact_key: c.contact_key,
        label: c.label,
        email: c.email,
        phone: c.phone || '',
        notes: c.notes || '',
        sort_order: i,
      }))
      if (rows.length > 0) {
        const { error } = await supabase.from('company_contacts').insert(rows)
        if (error) { showError('Failed to save contacts: ' + error.message); return }
      }
      await loadCompanyContacts()
      setContactsDirty(false)
      showSuccess('Company contacts saved')
    } finally {
      setContactsSaving(false)
    }
  }

  function resolveStepPlaceholders(template: string, record: any) {
    if (!template) return template
    return template
      .replace(/\{firstname\}/gi, record?.firstname || '')
      .replace(/\{surname\}/gi, record?.surname || '')
      .replace(/\{start_date\}/gi, record?.start_date ? new Date(record.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
      .replace(/\{manager\}/gi, record?.manager_name || record?.manager || '')
      .replace(/\{job_title\}/gi, record?.job_title || '')
      .replace(/\{department\}/gi, record?.department || '')
      .replace(/\{leaving_date\}/gi, record?.leaving_date ? new Date(record.leaving_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
  }

  async function sendStepNotification(stepConfig: StepConfig, record: any, stepLabel: string, workflowType: 'onboarding' | 'offboarding') {
    if (!selectedCompanyId || !stepConfig) return false
    let email = stepConfig.notify_email || ''
    if (stepConfig.notify_starter) {
      email = record.user_email || record.employee_email || ''
    } else if (stepConfig.notify_contact_key) {
      const contact = companyContacts.find(c => c.contact_key === stepConfig.notify_contact_key)
      if (contact?.email) email = contact.email
    }
    if (!email) { showError('No notification email configured for this step'); return false }

    // First try looking up the employee in the selected company
    let recipientEmp: { id: string } | null = null
    const { data: sameCompanyEmp } = await supabase.from('employees')
      .select('id').eq('company_id', selectedCompanyId).or(`user_email.eq.${email},email.eq.${email}`).maybeSingle()
    recipientEmp = sameCompanyEmp

    // If not found in this company, try across all companies (e.g. super admin in a different company)
    if (!recipientEmp) {
      const { data: anyCompanyEmp } = await supabase.from('employees')
        .select('id').or(`user_email.eq.${email},email.eq.${email}`).maybeSingle()
      recipientEmp = anyCompanyEmp
    }

    const subject = resolveStepPlaceholders(stepConfig.notify_subject || stepLabel, record)
    const body = resolveStepPlaceholders(stepConfig.notify_body || `Please complete: ${stepLabel}`, record)
    const isMeeting = !!stepConfig.meeting
    const meetingTitle = isMeeting ? resolveStepPlaceholders(stepConfig.meeting?.title || '', record) : undefined
    const meetingBody = isMeeting ? resolveStepPlaceholders(stepConfig.meeting?.body || '', record) : undefined

    if (recipientEmp) {
      await supabase.from('notifications').insert({
        company_id: selectedCompanyId,
        employee_id: recipientEmp.id,
        type: (stepConfig.step_type === 'app_notification' || stepConfig.step_type === 'email' || stepConfig.step_type === 'notice') ? 'info' : 'action',
        notification_type: isMeeting ? 'onboarding_meeting' : 'onboarding_task',
        title: subject,
        message: body,
        metadata: isMeeting ? { meeting_title: meetingTitle, meeting_body: meetingBody, meeting_attendees: stepConfig.meeting?.attendees, starter_name: `${record.firstname} ${record.surname}`, workflow_type: workflowType } : { workflow_type: workflowType, starter_name: `${record.firstname} ${record.surname}` },
        send_email: true,
      })
      showSuccess(`Notification sent to ${email}`)
      return true
    } else {
      // No employee record found at all — send email directly via edge function as fallback
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ to: email, subject, body })
        })
        showSuccess(`Notification emailed directly to ${email}`)
        return true
      } catch (err) {
        showError(`Failed to send notification email to ${email}`)
        return false
      }
    }
  }

  async function assignSurveyToEmployee(surveyId: string, employeeEmail: string, employeeName: string, stepKey: string) {
    if (!selectedCompanyId || !session?.user?.id) return false
    setSurveyAssigning(stepKey)
    const { data: emp } = await supabase.from('employees')
      .select('id').eq('company_id', selectedCompanyId).or(`user_email.eq.${employeeEmail},email.eq.${employeeEmail}`).maybeSingle()
    if (!emp) { showError('Employee not found — ensure they have been created first'); setSurveyAssigning(null); return false }
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + 30)
    const { data: deployment, error: depErr } = await supabase.from('survey_deployments').insert({
      company_id: selectedCompanyId,
      survey_id: surveyId,
      status: 'active',
      starts_at: new Date().toISOString(),
      ends_at: endDate.toISOString(),
      target_type: 'individual',
      target_values: [emp.id],
      total_recipients: 1,
      total_responses: 0,
      created_by: session.user.id,
    }).select('id').single()
    if (depErr || !deployment) { showError('Failed to deploy survey: ' + (depErr?.message || 'unknown error')); setSurveyAssigning(null); return false }
    const { error: resErr } = await supabase.from('survey_responses').insert({
      company_id: selectedCompanyId,
      deployment_id: deployment.id,
      employee_id: emp.id,
      status: 'pending',
    })
    if (resErr) { showError('Failed to assign survey: ' + resErr.message); setSurveyAssigning(null); return false }
    await supabase.from('notifications').insert({
      company_id: selectedCompanyId,
      employee_id: emp.id,
      type: 'action',
      notification_type: 'survey_assigned',
      title: 'Survey assigned',
      message: `You have a new survey to complete: ${companySurveys.find(s => s.id === surveyId)?.title || 'Survey'}`,
      send_email: true,
    })
    showSuccess(`Survey assigned to ${employeeName}`)
    setSurveyAssigning(null)
    return true
  }

  async function loadSyncStatus() {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('engine_schedule_sync')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .in('status', ['needs_review', 'pending', 'in_progress', 'failed'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
    setSyncRecords((data as SyncRecord[]) || [])
  }

  async function callIfoSync(action: string, body: Record<string, unknown> = {}) {
    if (!session || !selectedCompanyId) return null
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const res = await fetch(`${supabaseUrl}/functions/v1/inflowonboarder-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ company_id: selectedCompanyId, action, ...body }),
    })
    const data = await res.json()
    if (!res.ok) { showError(data.error || 'Sync request failed'); return null }
    return data
  }

  async function handleSyncRetry(syncId: number) {
    const result = await callIfoSync('mark-reviewed', { sync_id: syncId, review_action: 'retry' })
    if (result) {
      showSuccess('Sync record reset to pending — will retry shortly')
      loadSyncStatus()
    }
  }

  async function handleSyncDismiss(syncId: number) {
    const note = syncDismissNote[syncId] || ''
    const result = await callIfoSync('mark-reviewed', {
      sync_id: syncId,
      review_action: 'dismiss',
      note: note || 'Dismissed by admin',
      reviewed_by: session?.user?.email || 'admin',
    })
    if (result) {
      showSuccess('Sync record dismissed')
      setSyncDismissNote(prev => { const n = { ...prev }; delete n[syncId]; return n })
      loadSyncStatus()
    }
  }

  async function saveCustomSteps() {
    if (!selectedCompanyId || !settingsDirty) return
    setSettingsSaving(true)
    try {
      await supabase.from('onboard_workflow_steps').delete().eq('company_id', selectedCompanyId)
      const rows = editingSteps.map((s, i) => ({
        company_id: selectedCompanyId,
        step_key: s.step_key,
        label: s.label,
        icon: s.icon,
        description: s.description,
        sort_order: i,
        is_default: s.is_default,
        step_config: s.step_config || {},
      }))
      const { error } = await supabase.from('onboard_workflow_steps').insert(rows)
      if (error) { showError('Failed to save workflow steps: ' + error.message); return }

      const oldStepKeys = new Set(activeSteps.map(s => s.step_key))
      const newStepKeys = editingSteps.map(s => s.step_key).filter(k => !oldStepKeys.has(k))
      if (newStepKeys.length > 0) {
        const { data: onboardedRecords } = await supabase.from('onboarding')
          .select('id, is_complete, custom_steps_completed')
          .eq('company_id', selectedCompanyId)
          .eq('is_complete', true)
        if (onboardedRecords) {
          for (const rec of onboardedRecords) {
            const existing = (rec.custom_steps_completed as Record<string, boolean>) || {}
            const updated = { ...existing }
            newStepKeys.forEach(k => { updated[k] = true })
            await supabase.from('onboarding').update({ custom_steps_completed: updated }).eq('id', rec.id)
          }
        }
      }

      showSuccess('Workflow steps saved')
      setSettingsDirty(false)
      loadCustomSteps()
      load()
    } finally {
      setSettingsSaving(false)
    }
  }

  function initEditingSteps() {
    const steps = hasCustomSteps
      ? customSteps.map(s => ({ ...s }))
      : WORKFLOW_STEPS.map((s, i) => ({ step_key: s.key, label: s.label, icon: s.icon, description: s.description, sort_order: i, is_default: true, step_config: { step_type: s.step_type } as StepConfig }))
    setEditingSteps(steps)
    setSettingsDirty(false)
    setEditingIdx(null)
  }

  async function searchEmployeesForOffboard(query: string) {
    setOffboardEmployeeSearch(query)
    if (query.length < 2) { setOffboardEmployeeResults([]); return }
    const { data } = await supabase.from('employees')
      .select('id, first_name, last_name, email, job_title, department')
      .eq('company_id', selectedCompanyId)
      .eq('is_active', true)
      .eq('is_frozen', false)
      .or(`first_name.ilike.%${query.replace(/[,.()"\\]/g, '')}%,last_name.ilike.%${query.replace(/[,.()"\\]/g, '')}%,email.ilike.%${query.replace(/[,.()"\\]/g, '')}%`)
      .limit(10)
    setOffboardEmployeeResults(data || [])
  }

  async function createOffboardRecord(emp: typeof offboardEmployeeResults[0]) {
    const { error } = await supabase.from('offboarding').insert({
      company_id: selectedCompanyId,
      employee_id: emp.id,
      employee_name: `${emp.first_name} ${emp.last_name}`,
      employee_email: emp.email,
      job_title: emp.job_title,
      department: emp.department,
      end_date: offboardForm.end_date || null,
      reason: offboardForm.reason || null,
      status: 'pending',
    })
    if (error) { showError('Failed to create offboarding record: ' + error.message); return }
    showSuccess(`Offboarding started for ${emp.first_name} ${emp.last_name}`)
    setOffboardEmployeeSearch('')
    setOffboardEmployeeResults([])
    setOffboardForm({ end_date: '', reason: '' })
    loadOffboarding()
  }

  function openOffboardWorkflow(record: OffboardRecord) {
    setOffboardSelectedId(record.id)
    setOffboardChecks(record.workflow_steps || {})
    setOffboardSkips(record.skipped_steps || {})
    setLeaverCalcResult(record.leaver_calc_result || null)
    setLeaverCalcError('')
    const doneCount = OFFBOARD_STEPS.filter(s => record.workflow_steps?.[s.key] || record.skipped_steps?.[s.key]).length
    const nextStep = record.is_complete ? OFFBOARD_STEPS.length - 1 : Math.min(doneCount, OFFBOARD_STEPS.length - 1)
    setOffboardStep(nextStep)
    if (OFFBOARD_STEPS[nextStep]?.key === 'reassign_reports' && !record.workflow_steps?.reassign_reports && !record.skipped_steps?.reassign_reports) {
      loadReassignData(record)
    }
    if (OFFBOARD_STEPS[nextStep]?.key === 'remove_accounts') {
      loadLeaverM365Actions(record.id)
    }
    loadReviewData(record.employee_id)
    setTab('offboard-workflow')
  }

  const POST_LEAVE_DATE_STEPS = ['remove_accounts', 'convert_shared_mailbox', 'forward_to_manager', 'confirm_payments']

  async function completeOffboardStep(stepKey: string, bypassTimingWarning = false) {
    const record = offboardRecords.find(r => r.id === offboardSelectedId)
    if (!record) return

    if (!bypassTimingWarning && POST_LEAVE_DATE_STEPS.includes(stepKey) && record.end_date) {
      const leaveDate = new Date(record.end_date + 'T23:59:59')
      if (new Date() < leaveDate) {
        setTimingWarningStep(stepKey)
        return
      }
    }

    setTimingWarningStep(null)
    const newChecks = { ...offboardChecks, [stepKey]: true }
    const newSkips = { ...offboardSkips, [stepKey]: false }
    setOffboardChecks(newChecks)
    setOffboardSkips(newSkips)

    const isLastStep = stepKey === OFFBOARD_STEPS[OFFBOARD_STEPS.length - 1].key
    if (isLastStep) {
      setShowFreezeModal(record)
      return
    }

    await supabase.from('offboarding').update({
      workflow_steps: newChecks,
      skipped_steps: newSkips,
      status: 'in-progress',
    }).eq('id', record.id)
    loadOffboarding()
    const nextIdx = offboardStep + 1
    if (nextIdx < OFFBOARD_STEPS.length) {
      setOffboardStep(nextIdx)
      if (OFFBOARD_STEPS[nextIdx]?.key === 'remove_accounts') loadLeaverM365Actions(record.id)
    }
  }

  async function skipOffboardStep(stepKey: string) {
    const record = offboardRecords.find(r => r.id === offboardSelectedId)
    if (!record) return
    const newSkips = { ...offboardSkips, [stepKey]: true }
    setOffboardSkips(newSkips)
    await supabase.from('offboarding').update({
      skipped_steps: newSkips,
      status: 'in-progress',
    }).eq('id', record.id)
    loadOffboarding()
    const nextIdx = offboardStep + 1
    if (nextIdx < OFFBOARD_STEPS.length) {
      setOffboardStep(nextIdx)
      if (OFFBOARD_STEPS[nextIdx]?.key === 'remove_accounts') loadLeaverM365Actions(record.id)
    }
  }

  async function uncompleteOffboardStep(stepKey: string) {
    const record = offboardRecords.find(r => r.id === offboardSelectedId)
    if (!record) return
    const newChecks = { ...offboardChecks, [stepKey]: false }
    const newSkips = { ...offboardSkips, [stepKey]: false }
    setOffboardChecks(newChecks)
    setOffboardSkips(newSkips)
    await supabase.from('offboarding').update({
      workflow_steps: newChecks,
      skipped_steps: newSkips,
    }).eq('id', record.id)
    loadOffboarding()
  }

  async function loadReassignData(record: OffboardRecord) {
    const today = new Date().toISOString().split('T')[0]
    const [reportsRes, pendingRes, candidatesRes, meetingsRes, validationsRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, email')
        .eq('company_id', record.company_id).eq('manager_id', record.employee_id).eq('is_active', true),
      supabase.from('workflow_tracker').select('id', { count: 'exact', head: true })
        .eq('assigned_to', record.employee_email).eq('status', 'Pending').eq('company_id', record.company_id),
      supabase.from('employees').select('id, first_name, last_name, email')
        .eq('company_id', record.company_id).eq('is_active', true).neq('id', record.employee_id).order('first_name'),
      supabase.from('one_to_one_meetings').select('id', { count: 'exact', head: true })
        .eq('manager_id', record.employee_id).gte('scheduled_date', today),
      supabase.from('skill_validations').select('id', { count: 'exact', head: true })
        .eq('assigned_to', record.employee_id).eq('status', 'pending'),
    ])
    setReassignData({
      directReports: (reportsRes.data || []) as { id: string; first_name: string; last_name: string; email: string }[],
      pendingActions: (pendingRes.count || 0) + (meetingsRes.count || 0) + (validationsRes.count || 0),
    })
    setReassignCandidates((candidatesRes.data || []) as { id: string; first_name: string; last_name: string; email: string }[])
    setReassignTargetId('')
  }

  async function executeReassignment(record: OffboardRecord) {
    if (!reassignTargetId || !reassignData) return
    setReassignSaving(true)
    const target = reassignCandidates.find(c => c.id === reassignTargetId)
    if (!target) { setReassignSaving(false); return }

    const subIds = reassignData.directReports.map(r => r.id)
    if (subIds.length > 0) {
      await supabase.from('employees').update({ manager_id: reassignTargetId, manager_email: target.email })
        .in('id', subIds).eq('company_id', record.company_id)
    }

    if (reassignData.pendingActions > 0) {
      await supabase.from('workflow_tracker').update({ assigned_to: target.email })
        .eq('assigned_to', record.employee_email).eq('status', 'Pending').eq('company_id', record.company_id)
    }

    if (subIds.length > 0) {
      const { data: goalsToReassign } = await supabase.from('performance_goals')
        .select('id, employee_id')
        .eq('manager_id', record.employee_id)
        .in('status', ['active', 'pending', 'in_progress'])
        .eq('company_id', record.company_id)

      if (goalsToReassign && goalsToReassign.length > 0) {
        await supabase.from('performance_goals')
          .update({ manager_id: reassignTargetId, updated_at: new Date().toISOString() })
          .in('id', goalsToReassign.map(g => g.id))
          .eq('company_id', record.company_id)

        const targetName = `${target.first_name} ${target.last_name}`
        await supabase.from('workflow_tracker').insert({
          emp_display_name: targetName,
          step: 1,
          status: 'Complete',
          record_type: 'Performance',
          action: 'Goals reassigned during offboarding',
          employee_email: target.email,
          assigned_to: target.email,
          task_description: `${goalsToReassign.length} goal(s) reassigned to you from ${record.employee_name}'s direct reports`,
          approval_status: 'Reassigned',
          reminder_count: 1,
          company_id: record.company_id,
        })
        window.dispatchEvent(new Event('notifications-updated'))
      }
    }

    const today = new Date().toISOString().split('T')[0]
    const { data: futureMeetings } = await supabase.from('one_to_one_meetings')
      .select('id').eq('manager_id', record.employee_id).gte('scheduled_date', today)
    if (futureMeetings && futureMeetings.length > 0) {
      await supabase.from('one_to_one_meetings')
        .update({ manager_id: reassignTargetId })
        .in('id', futureMeetings.map(m => m.id))
    }

    const { data: pendingValidations } = await supabase.from('skill_validations')
      .select('id').eq('assigned_to', record.employee_id).eq('status', 'pending')
    if (pendingValidations && pendingValidations.length > 0) {
      await supabase.from('skill_validations')
        .update({ assigned_to: reassignTargetId })
        .in('id', pendingValidations.map(v => v.id))
    }

    const extras = (futureMeetings?.length || 0) + (pendingValidations?.length || 0)
    setReassignSaving(false)
    showSuccess(`${reassignData.directReports.length} employee(s), ${reassignData.pendingActions} pending action(s)${extras > 0 ? `, ${extras} meeting(s)/validation(s)` : ''} reassigned to ${target.first_name} ${target.last_name}`)
    completeOffboardStep('reassign_reports')
  }

  async function freezeEmployee(record: OffboardRecord, approve: boolean) {
    setShowFreezeModal(null)
    if (!approve) {
      showSuccess('Freeze declined — offboarding workflow left open')
      return
    }
    const newChecks = { ...offboardChecks, [OFFBOARD_STEPS[OFFBOARD_STEPS.length - 1].key]: true }
    await supabase.from('offboarding').update({
      workflow_steps: newChecks,
      skipped_steps: offboardSkips,
      is_complete: true,
      status: 'complete',
      frozen_at: new Date().toISOString(),
    }).eq('id', record.id)

    await supabase.from('employees').update({ is_active: false, is_frozen: true }).eq('id', record.employee_id)
    await supabase.from('company_users').update({ is_active: false }).eq('employee_id', record.employee_id).eq('company_id', selectedCompanyId)

    const deletionDate = new Date()
    deletionDate.setDate(deletionDate.getDate() + 30)
    const delDateStr = `${deletionDate.getFullYear()}-${String(deletionDate.getMonth() + 1).padStart(2, '0')}-${String(deletionDate.getDate()).padStart(2, '0')}`
    await supabase.from('frozen_employees').upsert({
      company_id: selectedCompanyId,
      employee_id: record.employee_id,
      employee_name: record.employee_name,
      employee_email: record.employee_email,
      deletion_date: delDateStr,
      status: 'awaiting_expiry',
    }, { onConflict: 'company_id,employee_id' })

    showSuccess(`${record.employee_name} has been frozen and added to deletion queue`)
    loadOffboarding()
    load()
    setTab('offboarding')
  }

  async function recoverEmployee(frozen: FrozenEmployee) {
    await supabase.from('employees').update({ is_active: true, is_frozen: false }).eq('id', frozen.employee_id)
    await supabase.from('company_users').update({ is_active: true }).eq('employee_id', frozen.employee_id).eq('company_id', selectedCompanyId)
    await supabase.from('frozen_employees').update({ status: 'recovered', recovered_at: new Date().toISOString() }).eq('id', frozen.id)
    showSuccess(`${frozen.employee_name} has been recovered and can log in again`)
    loadOffboarding()
    load()
  }

  async function cancelOffboarding(record: OffboardRecord) {
    if (!confirm(`Cancel offboarding for ${record.employee_name}?`)) return

    // Cancel engine leaver schedule if active
    const { data: offM365 } = await supabase.from('offboarding_m365_actions').select('schedule_id, schedule_status, external_ref').eq('offboarding_id', record.id).maybeSingle()
    if (offM365?.schedule_id && offM365.schedule_status && !['completed','cancelled','failed','missed','declined'].includes(offM365.schedule_status)) {
      try {
        await callIfoLeaver('cancel-leaver-schedule', { schedule_id: offM365.schedule_id, offboarding_id: record.id, reason: 'Offboarding cancelled from InflowHR' })
      } catch {
        await supabase.from('engine_schedule_sync').insert({
          company_id: selectedCompanyId,
          kind: 'leaver',
          action: 'cancel',
          record_id: record.id,
          schedule_id: offM365.schedule_id,
          external_ref: offM365.external_ref || `leaver-${record.id}`,
          source: 'ui',
        })
      }
    }

    const { error } = await supabase.from('offboarding').delete().eq('id', record.id)
    if (error) { showError('Failed to cancel offboarding: ' + error.message); return }
    showSuccess(`Offboarding cancelled for ${record.employee_name}`)
    if (offboardSelectedId === record.id) { setOffboardSelectedId(null); setTab('offboarding') }
    loadOffboarding()
  }

  async function deleteEmployee(frozen: FrozenEmployee) {
    if (!confirm(`Permanently delete ${frozen.employee_name}? This will remove ALL data and generate a deletion certificate. This cannot be undone.`)) return
    const { data, error } = await callRpcDirect('delete_employee_permanently', { p_employee_id: frozen.employee_id })
    if (error) { showError('Failed to delete: ' + error); return }
    showSuccess(`${frozen.employee_name} has been permanently deleted. Deletion certificate generated: ${(data as any)?.certificate_ref || 'N/A'}`)
    loadOffboarding()
    load()
  }

  async function extendFrozenPeriod(frozen: FrozenEmployee) {
    if (frozen.extended_at) { showError('Extension already applied — maximum one extension per employee'); return }
    if (!confirm(`Extend deletion date for ${frozen.employee_name} by 15 days?`)) return
    await supabase.from('frozen_employees').update({ extended_at: new Date().toISOString(), extension_days: 15 }).eq('id', frozen.id)
    showSuccess(`Deletion date extended by 15 days for ${frozen.employee_name}`)
    loadOffboarding()
  }

  async function cancelAllShifts(record: OffboardRecord) {
    if (reviewShifts.length === 0) return
    const ids = reviewShifts.map(s => s.id)
    await supabase.from('shift_assignments').delete().in('id', ids)
    await supabase.from('offboarding').update({ cleanup_shifts_done: true }).eq('id', record.id)
    setReviewShifts([])
    completeOffboardStep('review_shifts')
    showSuccess(`${ids.length} future shift(s) cancelled`)
  }

  async function cancelAllBookings(record: OffboardRecord) {
    if (reviewBookings.length === 0) return
    const ids = reviewBookings.map(b => b.id)
    await supabase.from('space_bookings').update({ status: 'cancelled' }).in('id', ids)
    await supabase.from('offboarding').update({ cleanup_bookings_done: true }).eq('id', record.id)
    setReviewBookings([])
    completeOffboardStep('review_bookings')
    showSuccess(`${ids.length} future booking(s) cancelled`)
  }

  async function unenrolAllBenefits(record: OffboardRecord) {
    if (reviewBenefits.length === 0) return
    const ids = reviewBenefits.map(b => b.id)
    await supabase.from('employee_benefits').update({ unenrolled_at: new Date().toISOString(), unenrolled_reason: 'offboarding' }).in('id', ids)
    await supabase.from('offboarding').update({ cleanup_benefits_done: true }).eq('id', record.id)
    setReviewBenefits([])
    completeOffboardStep('review_benefits')
    showSuccess(`${ids.length} benefit enrolment(s) cancelled`)
  }

  async function confirmAssets(record: OffboardRecord) {
    await supabase.from('offboarding').update({ cleanup_assets_done: true }).eq('id', record.id)
    completeOffboardStep('review_assets')
    showSuccess('Company assets confirmed as accounted for')
  }

  async function calculateLeaverFinancials(record: OffboardRecord) {
    setLeaverCalcLoading(true)
    setLeaverCalcError('')
    try {
      const { data: emp } = await supabase.from('employees')
        .select('id, first_name, last_name, start_date, annual_salary, hourly_rate, contracted_days, weekly_hours, notice_period, employment_category, leave_allowance, contract_type')
        .eq('id', record.employee_id).single()
      if (!emp) throw new Error('Employee not found')

      const { data: co } = await supabase.from('companies')
        .select('fy_start_month, bank_holiday_treatment, bank_holidays_per_year, leave_payout_policy, leave_clawback_clause, employer_pension_rate')
        .eq('id', record.company_id).single()

      const fyMonth = co?.fy_start_month || 4
      const now = new Date()
      let fyStartYear = now.getFullYear()
      const fyStartThisYear = new Date(fyStartYear, fyMonth - 1, 1)
      if (fyStartThisYear > now) fyStartYear--
      const leaveYearStart = `${fyStartYear}-${String(fyMonth).padStart(2, '0')}-01`

      const { data: balances } = await supabase.from('leave_balances')
        .select('used, carried_over, total_allowance')
        .eq('employee_id', record.employee_id)
        .eq('year', fyStartYear)

      const leaveTaken = (balances || []).reduce((s, b) => s + (b.used || 0), 0)
      const carryOver = (balances || []).reduce((s, b) => s + (b.carried_over || 0), 0)

      const { data: futureLeave } = await supabase.from('leave_requests')
        .select('start_date, end_date, days_requested, status')
        .eq('employee_id', record.employee_id)
        .in('status', ['approved', 'pending'])
        .gte('start_date', new Date().toISOString().slice(0, 10))

      const leaveBooked = (futureLeave || []).map(r => ({
        startDate: r.start_date,
        endDate: r.end_date,
        days: r.days_requested || 1,
      }))

      const contractedDays = emp.contracted_days as boolean[] | null
      const daysPerWeek = contractedDays ? contractedDays.filter(Boolean).length : 5

      const payType = emp.hourly_rate && !emp.annual_salary ? 'hourly' as const : 'salaried' as const

      const input: LeaverCalcInput = {
        employeeName: record.employee_name,
        employeeId: record.employee_id,
        startDate: emp.start_date || record.created_at.slice(0, 10),
        noticeGivenBy: record.notice_given_by || 'employee',
        noticeGivenDate: record.notice_given_date || record.created_at.slice(0, 10),
        noticePeriod: emp.notice_period,
        agreedLeavingDate: record.end_date,
        daysPerWeek,
        hoursPerWeek: emp.weekly_hours || (daysPerWeek * 7.5),
        payType,
        annualSalary: emp.annual_salary,
        hourlyRate: emp.hourly_rate,
        annualEntitlement: emp.leave_allowance || 28,
        bankHolidayTreatment: (co?.bank_holiday_treatment as LeaverCalcInput['bankHolidayTreatment']) || 'additional',
        bankHolidaysInYear: co?.bank_holidays_per_year || 8,
        leaveYearStart,
        carryOver,
        leaveTaken,
        leaveBooked,
        payoutPolicy: (co?.leave_payout_policy as LeaverCalcInput['payoutPolicy']) || 'pay_out',
        clawbackClause: co?.leave_clawback_clause || false,
        employerPensionRate: co?.employer_pension_rate || 3,
      }

      const result = runLeaverCalc(input)
      setLeaverCalcResult(result)

      await supabase.from('offboarding').update({ leaver_calc_result: result }).eq('id', record.id)

      setOffboardRecords(prev => prev.map(r =>
        r.id === record.id ? { ...r, leaver_calc_result: result } : r
      ))
    } catch (err: any) {
      setLeaverCalcError(err.message || 'Calculation failed')
    } finally {
      setLeaverCalcLoading(false)
    }
  }

  async function generateDataExport(record: OffboardRecord) {
    try {
      const { data: exportData, error } = await callRpcDirect('export_employee_data', { p_employee_id: record.employee_id })
      if (error) throw error
      const { generateLeaverExport } = await import('../../lib/employeeDataExport')
      const blob = await generateLeaverExport(exportData as any, record.employee_name, record.end_date, record.reason)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${record.employee_name.replace(/\s+/g, '_')}_Leaver_Data_Export.zip`
      a.click()
      URL.revokeObjectURL(url)
      await supabase.from('offboarding').update({ data_exported_at: new Date().toISOString() }).eq('id', record.id)
      completeOffboardStep('export_data')
      showSuccess('Leaver data export downloaded successfully')
    } catch (err: any) {
      showError('Export failed: ' + (err?.message || 'Unknown error'))
    }
  }

  async function saveOffboardCustomSteps() {
    if (!selectedCompanyId) return
    setSettingsSaving(true)
    try {
      await supabase.from('offboard_workflow_steps').delete().eq('company_id', selectedCompanyId)
      const rows = offboardEditingSteps.map((s, i) => ({
        company_id: selectedCompanyId,
        step_key: s.step_key,
        label: s.label,
        icon: s.icon,
        description: s.description,
        sort_order: i,
        is_default: s.is_default,
        step_config: s.step_config || {},
      }))
      const { error } = await supabase.from('offboard_workflow_steps').insert(rows)
      if (error) { showError('Failed to save offboarding steps: ' + error.message); return }
      await loadOffboardCustomSteps()
      setSettingsDirty(false)
      showSuccess('Offboarding workflow steps saved')
    } finally {
      setSettingsSaving(false)
    }
  }

  function stripFormulaChars(val: string): string {
    return val.replace(/^[=+\-@\t\r]+/, '')
  }

  function sanitisePayload(form: Record<string, string>): Record<string, any> {
    const dateFields = ['start_date', 'date_of_birth', 'probation_end_date']
    const numericFields = ['weekly_hours', 'annual_salary', 'leave_allowance']
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(form)) {
      if (dateFields.includes(k)) { out[k] = v || null }
      else if (numericFields.includes(k)) { out[k] = v ? parseFloat(v) : null }
      else { out[k] = v ? stripFormulaChars(v) : null }
    }
    return out
  }

  const isNonSso = selectedCompany?.auth_mode === 'non_sso'

  async function createStarter() {
    const emailRequired = !isNonSso
    if (!newForm.firstname || !newForm.surname || !selectedCompanyId) return
    if (emailRequired && !newForm.user_email) { showError('Work email is required for SSO companies'); return }
    if (isNonSso && !newForm.employee_number) { showError('Unique Employee ID is required for Non-SSO companies'); return }
    const niErr = validateNINumber(newForm.ni_number || '')
    if (niErr) { showError(niErr); return }
    const scErr = validateSortCode(newForm.bank_sort_code || '')
    if (scErr) { showError(scErr); return }
    const acErr = validateAccountNumber(newForm.bank_account_number || '')
    if (acErr) { showError(acErr); return }
    const sanitised = sanitisePayload(newForm)
    const payload = { ...sanitised, status: 'new', is_complete: false, company_id: selectedCompanyId }
    const { data, error } = await supabase.from('onboarding').insert(payload).select().single()
    if (error) { showError('Failed to create starter: ' + error.message); return }
    if (data) {
      setSelectedId(data.id)
      setWorkflowStep(0)
      setStepChecks({})
      setTab('workflow')
      showSuccess('Starter created')
      load()
      if (features.inflowonboarder_integration) {
        setM365Actions(null)
        const domain = ifoSettings?.account_domain
        setM365Upn(domain ? `${data.firstname.toLowerCase()}.${data.surname.toLowerCase()}@${domain}` : data.user_email)
        setM365DisplayName(`${data.firstname} ${data.surname}`)
        setM365Location('GB')
        loadM365Actions(data.id)
      }
    }
  }

  async function updateOnboardStatus(id: number, updates: Record<string, any>) {
    const { error } = await supabase.from('onboarding').update(updates).eq('id', id)
    if (error) { showError('Failed to update onboarding record: ' + error.message); return }
    load()
  }

  async function deleteRecord(id: number) {
    const record = records.find(r => r.id === id)
    if (!record) return
    if (!confirm(`Delete this onboarding record for ${record.firstname} ${record.surname}? Any matching frozen/deletion queue entries will also be removed.`)) return

    // Cancel engine joiner schedule if active
    const { data: onM365 } = await supabase.from('onboarding_m365_actions').select('schedule_id, schedule_status, external_ref').eq('onboarding_id', id).maybeSingle()
    if (onM365?.schedule_id && onM365.schedule_status && !['completed','cancelled','failed','missed','declined'].includes(onM365.schedule_status)) {
      try {
        await callIfo('cancel-schedule', { schedule_id: onM365.schedule_id, onboarding_id: id, reason: 'Onboarding record deleted from InflowHR' })
      } catch {
        await supabase.from('engine_schedule_sync').insert({
          company_id: selectedCompanyId,
          kind: 'joiner',
          action: 'cancel',
          record_id: id,
          schedule_id: onM365.schedule_id,
          external_ref: onM365.external_ref || `starter-${id}`,
          source: 'ui',
        })
      }
    }

    const { error } = await supabase.from('onboarding').delete().eq('id', id)
    if (error) { showError('Failed to delete record: ' + error.message); return }
    if (record.user_email && selectedCompanyId) {
      const { data: matchingFrozen } = await supabase.from('frozen_employees')
        .select('id, employee_name')
        .eq('company_id', selectedCompanyId)
        .eq('employee_email', record.user_email)
      if (matchingFrozen && matchingFrozen.length > 0) {
        await supabase.from('frozen_employees').delete().in('id', matchingFrozen.map(f => f.id))
        setFrozenEmployees(prev => prev.filter(f => !matchingFrozen.some(mf => mf.id === f.id)))
      }
      await supabase.from('deletion_certificates').delete()
        .eq('company_id', selectedCompanyId)
        .eq('employee_email', record.user_email)
      setDeletionCertificates(prev => prev.filter(c => c.employee_email !== record.user_email))
    }
    setRecords(prev => prev.filter(r => r.id !== id))
    showSuccess('Record deleted')
  }

  function getFunctionGating(funcId: string): { blocked: boolean; message: string; reason?: string } {
    const cache = ifoSettings?.functions_cache
    if (!cache) return { blocked: false, message: '' }
    const fc = cache[funcId]
    if (!fc) return { blocked: true, message: `Not available in your InflowOnboarder configuration` }
    if (fc.suspended) return { blocked: true, message: `Temporarily suspended by the InflowOnboarder service`, reason: fc.suspendedReason }
    if (!fc.enabled) return { blocked: true, message: `Switched off for your organisation in InflowOnboarder` }
    if (!fc.inPlan) return { blocked: true, message: `Not in your InflowOnboarder plan` }
    return { blocked: false, message: '' }
  }

  // ── M365 provisioning helpers (v2 workflow runs) ────────────────────────

  async function callIfo(action: string, body: Record<string, unknown> = {}) {
    if (!session || !selectedCompanyId) { console.log('[IFO] no session/company, skipping', action); return null }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    console.log('[IFO] calling', action, body)
    const res = await fetch(`${supabaseUrl}/functions/v1/inflowonboarder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ company_id: selectedCompanyId, action, ...body }),
    })
    const data = await res.json()
    console.log('[IFO]', action, 'response:', res.status, data)
    if (!res.ok) { showError(data.error || 'Request failed'); return null }
    return data
  }

  async function callIfoLeaver(action: string, body: Record<string, unknown> = {}) {
    if (!session || !selectedCompanyId) { console.log('[IFO-LEAVER] no session/company, skipping', action); return null }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    console.log('[IFO-LEAVER] calling', action, body)
    const res = await fetch(`${supabaseUrl}/functions/v1/inflowonboarder-leaver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ company_id: selectedCompanyId, action, ...body }),
    })
    const data = await res.json()
    console.log('[IFO-LEAVER]', action, 'response:', res.status, data)
    if (!res.ok) { showError(data.error || 'Request failed'); return null }
    return data
  }

  async function callIfoMover(action: string, body: Record<string, unknown> = {}) {
    if (!session || !selectedCompanyId) return null
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const res = await fetch(`${supabaseUrl}/functions/v1/inflowonboarder-mover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ company_id: selectedCompanyId, action, ...body }),
    })
    const data = await res.json()
    if (!res.ok) { showError(data.error || 'Request failed'); return null }
    return data
  }

  async function cancelMoverRoleChange(rc: RoleChange) {
    const m365 = moverM365[rc.id]
    const hrApplied = !!(rc.workflow_steps as any)?.update_records

    const parts: string[] = []
    if (hrApplied) parts.push('revert the HR record changes')
    if (m365?.schedule_id && m365.schedule_status !== 'completed' && m365.schedule_status !== 'cancelled' && m365.schedule_status !== 'failed') parts.push('cancel the M365 mover schedule')
    if (m365?.persona_schedule_id && m365.persona_schedule_status !== 'completed' && m365.persona_schedule_status !== 'cancelled' && m365.persona_schedule_status !== 'failed') parts.push('cancel the persona schedule')

    const detail = parts.length > 0 ? `\n\nThis will also ${parts.join(', ')}.` : ''
    if (!confirm(`Cancel role change for ${rc.employee_name}?${detail}\n\nThis action cannot be undone.`)) return

    try {
      if (hrApplied) {
        const reverts: Record<string, any> = {}
        const ch = rc.changes || {}
        if (ch.job_title?.old) reverts.job_title = ch.job_title.old
        if (ch.department?.old) reverts.department = ch.department.old
        if (ch.location?.old) reverts.location = ch.location.old
        if (ch.manager_name?.old) reverts.manager_name = ch.manager_name.old
        if (ch.manager_email?.old) reverts.manager_email = ch.manager_email.old
        if (ch.persona?.old) reverts.persona = ch.persona.old
        if (Object.keys(reverts).length > 0) {
          const { error } = await supabase.from('employees').update(reverts).eq('id', rc.employee_id)
          if (error) { showError('Failed to revert HR record: ' + error.message); return }
        }
      }

      if (m365?.schedule_id && m365.schedule_status !== 'completed' && m365.schedule_status !== 'cancelled' && m365.schedule_status !== 'failed') {
        await callIfoMover('cancel-mover-schedule', { schedule_id: m365.schedule_id, role_change_id: rc.id, reason: 'Role change cancelled' })
      }
      if (m365?.persona_schedule_id && m365.persona_schedule_status !== 'completed' && m365.persona_schedule_status !== 'cancelled' && m365.persona_schedule_status !== 'failed') {
        await callIfoMover('cancel-persona-schedule', { schedule_id: m365.persona_schedule_id, role_change_id: rc.id, reason: 'Role change cancelled' })
      }

      if (m365) {
        await supabase.from('mover_m365_actions').delete().eq('role_change_id', rc.id)
      }

      await supabase.from('role_changes').update({ status: 'cancelled', workflow_steps: {}, skipped_steps: {} }).eq('id', rc.id)

      if (moverSelectedId === rc.id) { setMoverSelectedId(null); setTab('movers') }
      await loadMovers()
      showSuccess(`Role change cancelled for ${rc.employee_name}`)
    } catch (err: any) {
      showError('Cancel failed: ' + (err?.message || 'Unknown error'))
    }
  }

  async function deleteMoverRoleChange(rc: RoleChange) {
    if (!confirm(`Permanently delete role change record for ${rc.employee_name}?\n\nThis will remove the role change and any associated M365 actions. This cannot be undone.`)) return
    try {
      const m365 = moverM365[rc.id]
      const terminalStatuses = ['completed','cancelled','failed','missed','declined']

      // Cancel engine mover schedule if active
      if (m365?.schedule_id && m365.schedule_status && !terminalStatuses.includes(m365.schedule_status)) {
        try {
          await callIfoMover('cancel-mover-schedule', { schedule_id: m365.schedule_id, role_change_id: rc.id, reason: 'Role change deleted from InflowHR' })
        } catch {
          await supabase.from('engine_schedule_sync').insert({
            company_id: selectedCompanyId,
            kind: 'mover',
            action: 'cancel',
            record_id: rc.id,
            schedule_id: m365.schedule_id,
            external_ref: m365.external_ref || `move-${rc.id}`,
            source: 'ui',
          })
        }
      }

      // Cancel engine persona schedule if active
      if (m365?.persona_schedule_id && m365.persona_schedule_status && !terminalStatuses.includes(m365.persona_schedule_status)) {
        try {
          await callIfoMover('cancel-persona-schedule', { schedule_id: m365.persona_schedule_id, role_change_id: rc.id, reason: 'Role change deleted from InflowHR' })
        } catch {
          await supabase.from('engine_schedule_sync').insert({
            company_id: selectedCompanyId,
            kind: 'persona',
            action: 'cancel',
            record_id: rc.id,
            schedule_id: m365.persona_schedule_id,
            external_ref: m365.persona_external_ref || `move-persona-${rc.id}`,
            source: 'ui',
          })
        }
      }

      await supabase.from('mover_m365_actions').delete().eq('role_change_id', rc.id)
      await supabase.from('role_changes').delete().eq('id', rc.id)
      if (moverSelectedId === rc.id) { setMoverSelectedId(null); setTab('movers') }
      await loadMovers()
      showSuccess(`Role change record deleted for ${rc.employee_name}`)
    } catch (err: any) {
      showError('Delete failed: ' + (err?.message || 'Unknown error'))
    }
  }

  async function loadM365Actions(onboardingId: number) {
    const [{ data }, { data: ifo }, { data: wt }, { data: schedulingFlag }] = await Promise.all([
      supabase.from('onboarding_m365_actions').select('*').eq('onboarding_id', onboardingId).maybeSingle(),
      supabase.from('inflowonboarder_integrations')
        .select('status, approver_mode, approver_name, approver_email, account_domain, licence_sku_id, licence_sku_name, licence_manager_name, group_name, schedule_templates_cache, passes_enabled, passes_ready, passes_status_detail, passes_available, functions_cache')
        .eq('company_id', selectedCompanyId).maybeSingle(),
      supabase.from('workflow_tracker').select('status, approval_status, assigned_to, updated_at, created_at')
        .eq('onboard_id', onboardingId).in('record_type', ['M365 Provisioning', 'M365 Scheduling']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('company_features').select('is_enabled').eq('company_id', selectedCompanyId).eq('feature_key', 'm365_scheduling').maybeSingle(),
    ])
    if (data && wt) {
      const merged = { ...data } as M365Actions
      merged.approval_sent_at = merged.approval_sent_at || wt.created_at
      if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
        merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
        merged.approved_by = wt.assigned_to || 'Approver'
        merged.approved_at = wt.updated_at || new Date().toISOString()
      } else if (wt.status === 'Pending') {
        merged.approval_status = 'pending'
      }
      setM365Actions(merged)
    } else {
      setM365Actions(data as M365Actions | null)
    }
    const m365SchedulingEnabled = schedulingFlag?.is_enabled === true
    setIfoConnected(ifo?.status === 'connected_ready')
    const { data: activeRows } = await supabase.from('onboarding_m365_actions')
      .select('onboarding_id, schedule_id, schedule_status')
      .eq('company_id', selectedCompanyId)
      .neq('onboarding_id', onboardingId)
      .in('schedule_status', ['pending_approval', 'scheduled', 'running'])
    let validCount = activeRows?.length || 0
    if (activeRows && activeRows.length > 0) {
      const staleChecks = activeRows.filter(r => r.schedule_id).map(async (r) => {
        const fresh = await callIfo('get-schedule', { schedule_id: r.schedule_id, onboarding_id: r.onboarding_id })
        if (fresh && ['cancelled', 'completed', 'failed'].includes(fresh.status)) {
          validCount--
        }
      })
      await Promise.all(staleChecks)
    }
    setM365ActiveProvisionCount(Math.max(0, validCount))
    if (ifo) {
      setIfoSettings({
        approver_mode: ifo.approver_mode || 'manager',
        approver_name: ifo.approver_name,
        approver_email: ifo.approver_email,
        account_domain: ifo.account_domain,
        licence_sku_id: ifo.licence_sku_id,
        licence_sku_name: ifo.licence_sku_name,
        licence_manager_name: ifo.licence_manager_name,
        group_name: ifo.group_name,
        passes_enabled: ifo.passes_enabled === true,
        passes_ready: ifo.passes_ready === true,
        passes_status_detail: ifo.passes_status_detail || null,
        passes_available: ifo.passes_available !== false,
        functions_cache: ifo.functions_cache || null,
      })
      const templates = Array.isArray(ifo.schedule_templates_cache) ? ifo.schedule_templates_cache : []
      const hasJoiner = templates.some((t: any) => t.id === 'hr.joiner' || t.templateId === 'hr.joiner')
      setM365SchedulingAvailable(hasJoiner && m365SchedulingEnabled)
    }
    if (data?.run_id && (!data?.run_status || ['checking_licence', 'provisioning'].includes(data?.run_status))) {
      const freshStatus = await callIfo('check-run', { run_id: data.run_id, onboarding_id: onboardingId })
      if (freshStatus?.status && freshStatus.status !== data.run_status) {
        const { data: refreshed } = await supabase.from('onboarding_m365_actions').select('*').eq('onboarding_id', onboardingId).maybeSingle()
        setM365Actions(refreshed as M365Actions | null)
      } else if (freshStatus?.status === 'checking_licence') {
        m365PollRun(data.run_id, onboardingId)
      }
    }
    if (data?.schedule_id && data.schedule_status && !['completed', 'cancelled', 'failed'].includes(data.schedule_status)) {
      const freshSchedule = await callIfo('get-schedule', { schedule_id: data.schedule_id, onboarding_id: onboardingId })
      if (freshSchedule) {
        const { data: refreshed } = await supabase.from('onboarding_m365_actions').select('*').eq('onboarding_id', onboardingId).maybeSingle()
        if (refreshed) {
          if (wt) {
            const merged = { ...refreshed } as M365Actions
            merged.approval_sent_at = merged.approval_sent_at || wt.created_at
            if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
              merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
              merged.approved_by = wt.assigned_to || 'Approver'
              merged.approved_at = wt.updated_at || new Date().toISOString()
            }
            setM365Actions(merged)
          } else {
            setM365Actions(refreshed as M365Actions | null)
          }
        }
      }
    }
    const effectiveApproval = (data && wt && wt.status === 'Complete' && wt.approval_status === 'Approved') ? 'approved' : data?.approval_status
    if (data && effectiveApproval === 'approved' && data.schedule_status === 'pending_approval' && !data.schedule_id) {
      const { data: rec } = await supabase.from('onboarding').select('id, firstname, surname, user_email, job_title, department, start_date').eq('id', onboardingId).maybeSingle()
      if (rec) {
        const result = await callIfo('create-schedule', {
          onboarding_id: rec.id,
          input: {
            givenName: rec.firstname,
            surname: rec.surname,
            displayName: `${rec.firstname} ${rec.surname}`,
            userPrincipalName: rec.user_email,
            usageLocation: 'GB',
            startDate: rec.start_date,
            jobTitle: rec.job_title,
            department: rec.department,
            employeeHireDate: rec.start_date,
          },
          options: { prepareDaysBefore: data.schedule_options?.prepareDaysBefore || 3 },
          approver_name: (wt?.assigned_to) || data.approved_by || 'InflowHR Approver',
          approver_email: ifo?.approver_email || '',
          approved_at: wt?.updated_at || data.approved_at || new Date().toISOString(),
          attempt: data.attempt_count_run || 0,
          ...(ifo?.passes_ready === true && ifo?.passes_available !== false ? { issuePass: true } : {}),
        })
        if (result && !result.use_run_now) {
          const { data: synced } = await supabase.from('onboarding_m365_actions').select('*').eq('onboarding_id', onboardingId).maybeSingle()
          if (synced) setM365Actions(synced as M365Actions | null)
        }
      }
    }
  }

  useEffect(() => {
    if (!selectedId || !m365Actions) return
    const isTerminal = m365Actions.run_status === 'completed' || m365Actions.run_status === 'failed'
    const isEngineStatus = !!m365Actions.run_status && !isTerminal
    const needsPoll = m365Actions.approval_status === 'pending' || (isEngineStatus && !['checking_licence', 'provisioning'].includes(m365Actions.run_status || ''))
    if (!needsPoll) return
    const slowPollStatuses = ['ready_for_approval', 'awaiting_approval']
    const pollInterval = slowPollStatuses.includes(m365Actions.run_status || '') || m365Actions.approval_status === 'pending' ? 5000 : 10000
    const timer = setInterval(async () => {
      const [{ data }, { data: wt }] = await Promise.all([
        supabase.from('onboarding_m365_actions').select('*').eq('onboarding_id', selectedId).maybeSingle(),
        supabase.from('workflow_tracker').select('status, approval_status, assigned_to, updated_at, created_at')
          .eq('onboard_id', selectedId).in('record_type', ['M365 Provisioning', 'M365 Scheduling']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (data) {
        const merged = { ...data } as M365Actions
        if (wt) {
          merged.approval_sent_at = merged.approval_sent_at || wt.created_at
          if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
            merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
            merged.approved_by = wt.assigned_to || 'Approver'
            merged.approved_at = wt.updated_at || new Date().toISOString()
          } else if (wt.status === 'Pending') {
            merged.approval_status = 'pending'
          }
        }
        setM365Actions(merged)
      }
    }, pollInterval)
    return () => clearInterval(timer)
  }, [m365Actions?.run_id, m365Actions?.approval_status, m365Actions?.run_status, selectedId])

  async function m365StartRun(record: OnboardRecord) {
    setM365Starting(true)
    const upn = m365Upn || record.user_email
    const result = await callIfo('start-run', {
      onboarding_id: record.id,
      attempt: m365Actions?.attempt_count_run || 0,
      issuePass: m365IssuePass && ifoSettings?.passes_ready && ifoSettings?.passes_available !== false,
      input: {
        givenName: record.firstname,
        surname: record.surname,
        displayName: m365DisplayName || `${record.firstname} ${record.surname}`,
        userPrincipalName: upn,
        usageLocation: m365Location || 'GB',
        ...(record.job_title ? { jobTitle: record.job_title } : {}),
        ...(record.department ? { department: record.department } : {}),
        ...(record.start_date ? { employeeHireDate: record.start_date.slice(0, 10) } : {}),
      },
    })
    setM365Starting(false)
    if (result?.run_id) {
      if (result.pass_warning) {
        showWarning(`${record.firstname} ${record.surname}'s account is being set up without a first-day pass: ${result.pass_warning}. They'll need another way to sign in on their first day.`)
      } else {
        showSuccess('M365 provisioning workflow started')
      }
      await loadM365Actions(record.id)
      if (result.status === 'checking_licence') {
        m365PollRun(result.run_id, record.id)
      }
    }
  }

  async function m365PollRun(runId: string, onboardingId: number) {
    setM365RunPolling(true)
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const result = await callIfo('check-run', { run_id: runId, onboarding_id: onboardingId })
      if (!result) break
      if (['ready_for_approval', 'licence_unavailable', 'completed', 'failed'].includes(result.status)) {
        if (result.status === 'completed') showSuccess('M365 provisioning complete')
        else if (result.status === 'failed') showError(result.friendlyError || 'Workflow failed')
        await loadM365Actions(onboardingId)
        setM365RunPolling(false)
        return
      }
    }
    await loadM365Actions(onboardingId)
    setM365RunPolling(false)
  }

  async function m365RefreshStatus(runId: string, onboardingId: number) {
    setM365RunPolling(true)
    const result = await callIfo('check-run', { run_id: runId, onboarding_id: onboardingId })
    if (result?.status) {
      if (result.status === 'completed') showSuccess('M365 provisioning complete')
      else if (result.status === 'failed') showError(result.friendlyError || 'Workflow failed')
      else if (result.status === 'ready_for_approval') showSuccess('Licence available — ready for approval')
      else if (result.status === 'licence_unavailable') showError(result.friendlyError || 'No licence seats available')
    }
    await loadM365Actions(onboardingId)
    setM365RunPolling(false)
  }

  async function m365RecheckRun(runId: string, onboardingId: number) {
    setM365RunPolling(true)
    const result = await callIfo('recheck-run', { run_id: runId, onboarding_id: onboardingId, attempt: (m365Actions?.attempt_count_run || 0) + 1 })
    if (result) {
      if (result.status === 'ready_for_approval') showSuccess('Licence now available — ready for approval')
      else if (result.status === 'licence_unavailable') showError(result.friendlyError || 'Still no seats available')
      await loadM365Actions(onboardingId)
    }
    setM365RunPolling(false)
  }

  async function m365SendApproval(record: OnboardRecord) {
    if (!ifoSettings) return
    setM365ApprovalSending(true)

    let approverEmail = ifoSettings.approver_email
    let approverName = ifoSettings.approver_name
    if (ifoSettings.approver_mode === 'manager') {
      approverEmail = (record as any).manager_email
      approverName = (record as any).manager
      if (!approverEmail) {
        showError('This starter has no manager set. Set a manager first, or switch to a nominated approver in the Integrations settings.')
        setM365ApprovalSending(false)
        return
      }
    }

    const starterName = `${record.firstname} ${record.surname}`
    const upn = m365Actions?.m365_upn || m365Upn || record.user_email
    const startDateStr = record.start_date ? new Date(record.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
    const taskDesc = `${starterName} — ${record.job_title || 'New Starter'}${startDateStr ? `, starting ${startDateStr}` : ''}\nM365 account: ${upn}`

    const { error: wtErr } = await supabase.from('workflow_tracker').insert({
      company_id: selectedCompanyId,
      record_type: 'M365 Provisioning',
      onboard_id: record.id,
      emp_display_name: `${record.firstname} ${record.surname}`,
      action: 'Approve',
      employee_email: approverEmail,
      assigned_to: approverEmail,
      status: 'Pending',
      approval_status: 'pending',
      task_description: taskDesc,
    })
    if (wtErr) {
      showError(`Failed to create approval task: ${wtErr.message}`)
      setM365ApprovalSending(false)
      return
    }

    const { data: approverEmp } = await supabase.from('employees')
      .select('id').eq('company_id', selectedCompanyId).or(`user_email.eq.${approverEmail},email.eq.${approverEmail}`).maybeSingle()
    if (approverEmp) {
      await supabase.from('notifications').insert({
        company_id: selectedCompanyId,
        employee_id: approverEmp.id,
        type: 'action',
        notification_type: 'm365_approval',
        title: 'M365 Provisioning Approval',
        message: `Please approve M365 account provisioning for ${record.firstname} ${record.surname}`,
        send_email: true,
      })
    }

    await supabase.from('onboarding_m365_actions').update({
      approval_sent_at: new Date().toISOString(),
      approval_status: 'pending',
      updated_at: new Date().toISOString(),
    }).eq('onboarding_id', record.id)

    try {
      await callIfo('check-run', { run_id: m365Actions?.run_id, onboarding_id: record.id })
    } catch (_) {}

    showSuccess(`Approval request sent to ${approverName || approverEmail}`)
    await loadM365Actions(record.id)
    setM365ApprovalSending(false)
  }

  async function m365ProceedRun(record: OnboardRecord) {
    if (!m365Actions?.run_id) return
    setM365Proceeding(true)
    const approvedByRaw = m365Actions.approved_by || ''
    const emailMatch = approvedByRaw.match(/<([^>]+)>/)
    const approverEmail = emailMatch ? emailMatch[1] : approvedByRaw
    const approverName = emailMatch ? approvedByRaw.replace(/<[^>]+>/, '').trim() : approvedByRaw
    const result = await callIfo('proceed-run', {
      run_id: m365Actions.run_id,
      onboarding_id: record.id,
      approver_name: approverName,
      approver_email: approverEmail,
      approved_at: m365Actions.approved_at,
      attempt: (m365Actions?.attempt_count_run || 0) + 1,
    })
    setM365Proceeding(false)
    if (result) {
      if (result.status === 'completed') {
        showSuccess('M365 provisioning complete')
      } else if (result.status === 'provisioning' || result.status === 'checking_licence') {
        showSuccess('Provisioning started — polling for completion...')
        m365PollRun(m365Actions.run_id, record.id)
        return
      } else if (result.status === 'failed') {
        showError(result.friendlyError || 'Provisioning failed')
      }
      await loadM365Actions(record.id)
    }
  }

  async function m365MarkCompleteManual(onboardingId: number) {
    const result = await callIfo('mark-complete-manual', { onboarding_id: onboardingId })
    if (result) {
      showSuccess('Marked as manually completed')
      await loadM365Actions(onboardingId)
    }
  }

  // ── M365 scheduling helpers (joiner) ────────────────────────────────────

  async function m365SendScheduleApproval(record: OnboardRecord) {
    if (!selectedCompanyId) return
    setM365ApprovalSending(true)
    const startDate = record.start_date
    const prepDate = new Date(new Date(startDate).getTime() - m365PrepareDays * 86400000)
    const planDesc = `Schedule M365 Account for ${record.firstname} ${record.surname}:\n` +
      `• Prepare account: ${prepDate.toLocaleDateString('en-GB')} at 09:00\n` +
      `• Enable sign-in: ${new Date(startDate).toLocaleDateString('en-GB')} at 08:00`
    const approverMode = ifoSettings?.approver_mode || 'manager'
    let approverEmail: string | null = null
    if (approverMode === 'manager' && record.manager_email) {
      approverEmail = record.manager_email
    } else if (approverMode === 'nominated' && ifoSettings?.approver_email) {
      approverEmail = ifoSettings.approver_email
    }
    if (!approverEmail) { showError('No approver found. Check the approver settings on the Integrations page.'); setM365ApprovalSending(false); return }
    const { error: wtErr } = await supabase.from('workflow_tracker').insert({
      company_id: selectedCompanyId,
      onboard_id: record.id,
      record_type: 'M365 Scheduling',
      action: 'Approve',
      task_description: planDesc,
      emp_display_name: `${record.firstname} ${record.surname}`,
      employee_email: approverEmail,
      assigned_to: approverEmail,
      status: 'Pending',
      approval_status: 'pending',
    })
    if (wtErr) { showError(`Failed to create approval task: ${wtErr.message}`); setM365ApprovalSending(false); return }
    const { data: approverEmp } = await supabase.from('employees')
      .select('id').eq('company_id', selectedCompanyId).or(`user_email.eq.${approverEmail},email.eq.${approverEmail}`).maybeSingle()
    if (approverEmp) {
      await supabase.from('notifications').insert({
        company_id: selectedCompanyId,
        employee_id: approverEmp.id,
        type: 'action',
        notification_type: 'm365_schedule_approval',
        title: 'M365 Schedule Approval Required',
        message: `Please approve the M365 account schedule for ${record.firstname} ${record.surname}.`,
        send_email: true,
        action_type: 'M365 Scheduling',
        action_record_id: record.id,
      })
    }
    const { error: upsertErr } = await supabase.from('onboarding_m365_actions').upsert({
      onboarding_id: record.id,
      company_id: selectedCompanyId,
      approval_sent_at: new Date().toISOString(),
      approval_status: 'pending',
      schedule_status: 'pending_approval',
      schedule_options: { prepareDaysBefore: m365PrepareDays },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'onboarding_id' })
    if (upsertErr) { showError(`Failed to save schedule status: ${upsertErr.message}`); setM365ApprovalSending(false); return }
    showSuccess('Schedule approval sent')
    setM365ApprovalSending(false)
    await loadM365Actions(record.id)
  }

  async function tapRevealPass(onboardingId: number, passId: string) {
    setTapRevealing(true)
    const result = await callIfo('reveal-pass', { onboarding_id: onboardingId, pass_id: passId })
    setTapRevealing(false)
    if (result) {
      setTapRevealData({
        pass: result.temporaryAccessPass || result.pass || '',
        upn: result.userPrincipalName || m365Actions?.m365_upn || '',
        expiresAt: result.expiresAt || m365Actions?.pass_expires_at || '',
        oneTimeUse: result.isUsableOnce !== false,
        notice: result.notice || '',
      })
      setTapRevealConfirmOpen(false)
      await loadM365Actions(onboardingId)
    }
  }

  async function tapRequestNewPass(onboardingId: number) {
    setTapRequesting(true)
    const result = await callIfo('request-new-pass', { onboarding_id: onboardingId })
    if (!result?.jobId) { setTapRequesting(false); return }
    setTapJobPolling(true)
    const poll = async (attempts: number) => {
      if (attempts > 30) { setTapRequesting(false); setTapJobPolling(false); showError('Pass request timed out'); return }
      const job = await callIfo('check-pass-job', { job_id: result.jobId, onboarding_id: onboardingId })
      if (job?.status === 'succeeded') {
        setTapRequesting(false)
        setTapJobPolling(false)
        showSuccess('New pass is ready')
        await loadM365Actions(onboardingId)
      } else if (job?.status === 'failed') {
        setTapRequesting(false)
        setTapJobPolling(false)
        showError(job.error?.message || 'Failed to create new pass')
      } else {
        setTimeout(() => poll(attempts + 1), 2000)
      }
    }
    poll(0)
  }

  async function m365CreateSchedule(record: OnboardRecord) {
    if (!selectedCompanyId || !m365Actions) return
    setM365ScheduleCreating(true)
    const upn = m365Upn || record.user_email
    const result = await callIfo('create-schedule', {
      onboarding_id: record.id,
      input: {
        givenName: record.firstname,
        surname: record.surname,
        displayName: m365DisplayName || `${record.firstname} ${record.surname}`,
        userPrincipalName: upn,
        usageLocation: m365Location || 'GB',
        startDate: record.start_date,
        jobTitle: record.job_title,
        department: record.department,
        employeeHireDate: record.start_date,
      },
      options: { prepareDaysBefore: m365Actions.schedule_options?.prepareDaysBefore || m365PrepareDays },
      approver_name: m365Actions.approved_by || 'InflowHR Approver',
      approver_email: ifoSettings?.approver_email || '',
      approved_at: m365Actions.approved_at || new Date().toISOString(),
      attempt: m365Actions.attempt_count_run || 0,
      ...(ifoSettings?.passes_ready && ifoSettings?.passes_available !== false && m365IssuePass ? { issuePass: true } : {}),
    })
    setM365ScheduleCreating(false)
    if (result) {
      if (result.use_run_now) {
        showError(result.error || 'Start date is too close — use Run Now instead')
        setM365ScheduleMode('now')
      } else {
        if (result.pass_warning) {
          showWarning(`${record.firstname} ${record.surname}'s account is being set up without a first-day pass: ${result.pass_warning}. They'll need another way to sign in on their first day.`)
        } else {
          showSuccess(result.recovered ? 'Existing schedule synced' : 'Schedule created')
        }
        if (result.id && m365Actions) {
          setM365Actions({ ...m365Actions, schedule_id: result.id, schedule_status: result.status || 'scheduled', schedule_message: result.message, schedule_stages: result.stages, schedule_next_due_at: result.nextDueAt })
        }
      }
      await loadM365Actions(record.id)
    }
  }

  async function m365CancelSchedule(scheduleId: string, onboardingId: number, reason: string) {
    if (!confirm('Cancel this schedule? The engine will release any reserved licences and groups.')) return
    setM365ScheduleCancelling(true)
    const result = await callIfo('cancel-schedule', { schedule_id: scheduleId, onboarding_id: onboardingId, reason })
    setM365ScheduleCancelling(false)
    if (result) {
      showSuccess('Schedule cancelled')
      await loadM365Actions(onboardingId)
    }
  }

  async function m365RecheckSchedule(scheduleId: string, onboardingId: number) {
    setM365ScheduleRefreshing(true)
    const result = await callIfo('recheck-schedule', { schedule_id: scheduleId, onboarding_id: onboardingId })
    setM365ScheduleRefreshing(false)
    if (result) {
      showSuccess('Schedule rechecked')
      await loadM365Actions(onboardingId)
    }
  }

  // ── M365 offboarding helpers (leaver workflow runs) ────────────────────
  interface LeaverM365Actions {
    offboarding_id: number
    run_id: string | null
    run_status: string | null
    run_error: any
    run_result: any
    approval_sent_at: string | null
    approval_status: string | null
    approved_by: string | null
    approved_at: string | null
    employee_upn: string | null
    attempt_count_run: number
    schedule_id: string | null
    schedule_status: string | null
    schedule_message: string | null
    schedule_stages: any[] | null
    schedule_next_due_at: string | null
    schedule_options: any | null
  }
  interface IfoOffboardSettings {
    offboard_approver_mode: 'same_as_joiner' | 'nominated' | 'manager'
    offboard_approver_name: string | null
    offboard_approver_email: string | null
    approver_mode: 'manager' | 'nominated'
    approver_name: string | null
    approver_email: string | null
  }
  const [leaverM365Actions, setLeaverM365Actions] = useState<LeaverM365Actions | null>(null)
  const [leaverM365RunPolling, setLeaverM365RunPolling] = useState(false)
  const [leaverM365Starting, setLeaverM365Starting] = useState(false)
  const [leaverM365ApprovalSending, setLeaverM365ApprovalSending] = useState(false)
  const [leaverM365Proceeding, setLeaverM365Proceeding] = useState(false)
  const [ifoOffboardSettings, setIfoOffboardSettings] = useState<IfoOffboardSettings | null>(null)
  const [leaverScheduleMode, setLeaverScheduleMode] = useState<'now' | 'schedule'>('now')
  const [leaverSchedulingAvailable, setLeaverSchedulingAvailable] = useState(false)
  const [leaverLicenceRemovalDays, setLeaverLicenceRemovalDays] = useState(30)
  const [leaverRemovalDate, setLeaverRemovalDate] = useState('')
  const [leaverScheduleCreating, setLeaverScheduleCreating] = useState(false)
  const [leaverScheduleCancelling, setLeaverScheduleCancelling] = useState(false)
  const [leaverScheduleRefreshing, setLeaverScheduleRefreshing] = useState(false)

  async function loadLeaverM365Actions(offboardingId: number) {
    try {
      const [{ data }, { data: ifo }, { data: wt }, { data: schedulingFlag }] = await Promise.all([
        supabase.from('offboarding_m365_actions').select('*').eq('offboarding_id', offboardingId).maybeSingle(),
        supabase.from('inflowonboarder_integrations')
          .select('status, approver_mode, approver_name, approver_email, offboard_approver_mode, offboard_approver_name, offboard_approver_email, schedule_templates_cache')
          .eq('company_id', selectedCompanyId).maybeSingle(),
        supabase.from('workflow_tracker').select('status, approval_status, assigned_to, updated_at, created_at')
          .eq('onboard_id', offboardingId).in('record_type', ['M365 Offboarding', 'M365 Leaver Scheduling']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('company_features').select('is_enabled').eq('company_id', selectedCompanyId).eq('feature_key', 'm365_scheduling').maybeSingle(),
      ])
      const m365SchedulingEnabled = schedulingFlag?.is_enabled === true
      setIfoConnected(ifo?.status === 'connected_ready')
      if (ifo) {
        setIfoOffboardSettings({
          offboard_approver_mode: ifo.offboard_approver_mode || 'same_as_joiner',
          offboard_approver_name: ifo.offboard_approver_name,
          offboard_approver_email: ifo.offboard_approver_email,
          approver_mode: ifo.approver_mode || 'manager',
          approver_name: ifo.approver_name,
          approver_email: ifo.approver_email,
        })
        const templates = Array.isArray(ifo.schedule_templates_cache) ? ifo.schedule_templates_cache : []
        const hasLeaver = templates.some((t: any) => t.id === 'hr.leaver' || t.templateId === 'hr.leaver')
        setLeaverSchedulingAvailable(hasLeaver && m365SchedulingEnabled)
      }
      const terminalStatuses = ['completed', 'failed']
      if (data?.run_id && data?.run_status && !terminalStatuses.includes(data.run_status)) {
        const freshStatus = await callIfoLeaver('check-leaver-run', { run_id: data.run_id, offboarding_id: offboardingId })
        if (freshStatus?.status && freshStatus.status !== data.run_status) {
          const { data: refreshed } = await supabase.from('offboarding_m365_actions').select('*').eq('offboarding_id', offboardingId).maybeSingle()
          if (refreshed && wt) {
            const merged = { ...refreshed } as LeaverM365Actions
            merged.approval_sent_at = merged.approval_sent_at || wt.created_at
            if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
              merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
              merged.approved_by = wt.assigned_to || 'Approver'
              merged.approved_at = wt.updated_at || new Date().toISOString()
            } else if (wt.status === 'Pending') {
              merged.approval_status = 'pending'
            }
            setLeaverM365Actions(merged)
          } else {
            setLeaverM365Actions(refreshed as LeaverM365Actions | null)
          }
          return
        }
      }
      if (data && wt) {
        const merged = { ...data } as LeaverM365Actions
        merged.approval_sent_at = merged.approval_sent_at || wt.created_at
        if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
          merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
          merged.approved_by = wt.assigned_to || 'Approver'
          merged.approved_at = wt.updated_at || new Date().toISOString()
        } else if (wt.status === 'Pending') {
          merged.approval_status = 'pending'
        }
        setLeaverM365Actions(merged)
      } else {
        setLeaverM365Actions(data as LeaverM365Actions | null)
      }
      const effectiveApproval = (data && wt && wt.status === 'Complete' && wt.approval_status === 'Approved') ? 'approved' : data?.approval_status
      if (data && effectiveApproval === 'approved' && data.schedule_status === 'pending_approval' && !data.schedule_id) {
        const { data: rec } = await supabase.from('offboarding').select('id, employee_name, employee_email, end_date').eq('id', offboardingId).maybeSingle()
        if (rec && rec.employee_email && rec.end_date) {
          const result = await callIfoLeaver('create-leaver-schedule', {
            offboarding_id: rec.id,
            user_principal_name: rec.employee_email,
            display_name: rec.employee_name,
            leave_date: rec.end_date,
            options: { licenceRemovalDelayDays: data.schedule_options?.licenceRemovalDelayDays || 30 },
            approver_name: (wt?.assigned_to) || 'InflowHR Approver',
            approver_email: ifo?.offboard_approver_email || ifo?.approver_email || '',
            approved_at: wt?.updated_at || new Date().toISOString(),
            attempt: data.attempt_count_run || 0,
          })
          if (result && !result.use_run_now) {
            const { data: synced } = await supabase.from('offboarding_m365_actions').select('*').eq('offboarding_id', offboardingId).maybeSingle()
            if (synced) setLeaverM365Actions(synced as LeaverM365Actions | null)
          }
        }
      }
    } finally { /* loading complete */ }
  }

  async function leaverM365StartRun(record: OffboardRecord) {
    setLeaverM365Starting(true)
    const upn = record.employee_email
    const result = await callIfoLeaver('start-leaver-run', {
      offboarding_id: record.id,
      user_principal_name: upn,
      attempt: leaverM365Actions?.attempt_count_run || 0,
    })
    setLeaverM365Starting(false)
    if (result?.run_id) {
      showSuccess('M365 offboarding workflow started')
      await loadLeaverM365Actions(record.id)
      if (result.status === 'checking_account') {
        leaverM365PollRun(result.run_id, record.id)
      }
    }
  }

  async function leaverM365PollRun(runId: string, offboardingId: number) {
    setLeaverM365RunPolling(true)
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const result = await callIfoLeaver('check-leaver-run', { run_id: runId, offboarding_id: offboardingId })
      if (!result) break
      if (['ready_for_approval', 'account_blocked', 'completed', 'failed'].includes(result.status)) {
        if (result.status === 'completed') showSuccess('M365 offboarding complete')
        else if (result.status === 'failed') showError(result.friendlyError || 'Workflow failed')
        await loadLeaverM365Actions(offboardingId)
        setLeaverM365RunPolling(false)
        return
      }
    }
    await loadLeaverM365Actions(offboardingId)
    setLeaverM365RunPolling(false)
  }

  async function leaverM365RefreshStatus(runId: string, offboardingId: number) {
    setLeaverM365RunPolling(true)
    const result = await callIfoLeaver('check-leaver-run', { run_id: runId, offboarding_id: offboardingId })
    if (result?.status) {
      if (result.status === 'completed') showSuccess('M365 offboarding complete')
      else if (result.status === 'failed') showError(result.friendlyError || 'Offboarding failed')
      else if (result.status === 'ready_for_approval') showSuccess('Ready for approval')
      else if (result.status === 'account_blocked') showError(result.friendlyError || 'Account blocked — see details')
    }
    await loadLeaverM365Actions(offboardingId)
    setLeaverM365RunPolling(false)
  }

  async function leaverM365RecheckRun(runId: string, offboardingId: number) {
    setLeaverM365RunPolling(true)
    const result = await callIfoLeaver('recheck-leaver-run', { run_id: runId, offboarding_id: offboardingId, attempt: (leaverM365Actions?.attempt_count_run || 0) + 1 })
    if (result) {
      if (result.status === 'ready_for_approval') showSuccess('Account now ready for offboarding approval')
      else if (result.status === 'account_blocked') showError(result.friendlyError || 'Account still blocked')
      await loadLeaverM365Actions(offboardingId)
    }
    setLeaverM365RunPolling(false)
  }

  useEffect(() => {
    if (!leaverM365Actions?.run_id || !offboardSelectedId) return
    const isTerminal = leaverM365Actions.run_status === 'completed' || leaverM365Actions.run_status === 'failed'
    const isEngineStatus = !!leaverM365Actions.run_status && !isTerminal
    const needsPoll = leaverM365Actions.approval_status === 'pending' || isEngineStatus
    if (!needsPoll) return
    const slowPollStatuses = ['ready_for_approval', 'awaiting_approval', 'account_blocked']
    const pollInterval = slowPollStatuses.includes(leaverM365Actions.run_status || '') ? 60000 : 10000
    const timer = setInterval(async () => {
      if (isEngineStatus && leaverM365Actions?.run_id) {
        await callIfoLeaver('check-leaver-run', { run_id: leaverM365Actions.run_id, offboarding_id: offboardSelectedId })
      }
      const [{ data }, { data: wt }] = await Promise.all([
        supabase.from('offboarding_m365_actions').select('*').eq('offboarding_id', offboardSelectedId).maybeSingle(),
        supabase.from('workflow_tracker').select('status, approval_status, assigned_to, updated_at, created_at')
          .eq('onboard_id', offboardSelectedId).eq('record_type', 'M365 Offboarding').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (data && wt) {
        const merged = { ...data } as LeaverM365Actions
        merged.approval_sent_at = merged.approval_sent_at || wt.created_at
        if (wt.status === 'Complete' && (wt.approval_status === 'Approved' || wt.approval_status === 'Declined')) {
          merged.approval_status = wt.approval_status === 'Approved' ? 'approved' : 'declined'
          merged.approved_by = wt.assigned_to || 'Approver'
          merged.approved_at = wt.updated_at || new Date().toISOString()
        } else if (wt.status === 'Pending') {
          merged.approval_status = 'pending'
        }
        setLeaverM365Actions(merged)
      } else if (data) {
        setLeaverM365Actions(data as LeaverM365Actions)
      }
    }, pollInterval)
    return () => clearInterval(timer)
  }, [leaverM365Actions?.run_id, leaverM365Actions?.approval_status, leaverM365Actions?.run_status, offboardSelectedId])

  // ── Persona schedule polling ──────────────────────────────────────────
  useEffect(() => {
    if (!features.inflowonboarder_integration || !ifoConnected || !selectedCompanyId) return
    const FINAL_STATUSES = ['completed', 'cancelled', 'failed', 'missed', 'declined']
    const hasActivePersonaSchedules = Object.values(moverM365).some(
      (m) => m.persona_schedule_id && !FINAL_STATUSES.includes(m.persona_schedule_status || '')
    )
    if (!hasActivePersonaSchedules && moverRecords.length > 0) return

    // Initial poll on page load
    callIfoMover('poll-active-persona-schedules', {}).then(() => loadMovers())

    // Check if any schedule is due soon (within 2 minutes)
    const hasSoonDue = Object.values(moverM365).some((m) => {
      if (!m.persona_schedule_next_due_at || FINAL_STATUSES.includes(m.persona_schedule_status || '')) return false
      const dueAt = new Date(m.persona_schedule_next_due_at).getTime()
      return dueAt - Date.now() < 2 * 60 * 1000
    })
    const pollMs = hasSoonDue ? 60000 : 15 * 60 * 1000

    const timer = setInterval(async () => {
      await callIfoMover('poll-active-persona-schedules', {})
      await loadMovers()
    }, pollMs)
    return () => clearInterval(timer)
  }, [features.inflowonboarder_integration, ifoConnected, selectedCompanyId, moverRecords.length])

  async function leaverM365SendApproval(record: OffboardRecord) {
    if (!ifoOffboardSettings) return
    setLeaverM365ApprovalSending(true)

    let resolvedMode = ifoOffboardSettings.offboard_approver_mode
    let approverEmail: string | null = null
    let approverName: string | null = null

    if (resolvedMode === 'same_as_joiner') {
      resolvedMode = ifoOffboardSettings.approver_mode
      approverEmail = ifoOffboardSettings.approver_email
      approverName = ifoOffboardSettings.approver_name
    } else if (resolvedMode === 'nominated') {
      approverEmail = ifoOffboardSettings.offboard_approver_email
      approverName = ifoOffboardSettings.offboard_approver_name
    }

    if (resolvedMode === 'manager') {
      const { data: emp } = await supabase.from('employees').select('manager_email').eq('id', record.employee_id).maybeSingle()
      approverEmail = emp?.manager_email || null
      approverName = null
      if (!approverEmail) {
        showError('This leaver has no manager set. Set a manager first, or switch to a nominated approver in the Integrations settings.')
        setLeaverM365ApprovalSending(false)
        return
      }
    }

    if (!approverEmail) {
      showError('No approver email configured. Check the Offboarding Approver setting in Integrations.')
      setLeaverM365ApprovalSending(false)
      return
    }

    const { data: existingWt } = await supabase.from('workflow_tracker')
      .select('id, status').eq('onboard_id', record.id).eq('record_type', 'M365 Offboarding').eq('status', 'Pending').maybeSingle()
    if (existingWt) {
      showError('An approval request is already pending for this leaver. Use Refresh to check its status.')
      setLeaverM365ApprovalSending(false)
      return
    }

    const leaverName = record.employee_name
    const upn = leaverM365Actions?.employee_upn || record.employee_email
    const endDateStr = record.end_date ? new Date(record.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
    const taskDesc = `${leaverName} — ${record.job_title || 'Leaver'}${endDateStr ? `, last day ${endDateStr}` : ''}\nM365 account: ${upn}`

    const { error: wtErr } = await supabase.from('workflow_tracker').insert({
      company_id: selectedCompanyId,
      record_type: 'M365 Offboarding',
      onboard_id: record.id,
      emp_display_name: leaverName,
      action: 'Approve',
      employee_email: approverEmail,
      assigned_to: approverEmail,
      status: 'Pending',
      approval_status: 'pending',
      task_description: taskDesc,
    })
    if (wtErr) {
      showError(`Failed to create approval task: ${wtErr.message}`)
      setLeaverM365ApprovalSending(false)
      return
    }

    const { data: approverEmp } = await supabase.from('employees')
      .select('id').eq('company_id', selectedCompanyId).or(`user_email.eq.${approverEmail},email.eq.${approverEmail}`).maybeSingle()
    if (approverEmp) {
      await supabase.from('notifications').insert({
        company_id: selectedCompanyId,
        employee_id: approverEmp.id,
        type: 'action',
        notification_type: 'm365_offboard_approval',
        title: 'M365 Offboarding Approval',
        message: `Offboarding ${record.employee_name}'s Microsoft 365 account needs your approval. Please approve it in the InflowHR app.`,
        send_email: true,
      })
    }

    if (leaverM365Actions) {
      setLeaverM365Actions({
        ...leaverM365Actions,
        approval_sent_at: new Date().toISOString(),
        approval_status: 'pending',
      })
    }

    try {
      await callIfoLeaver('check-leaver-run', { run_id: leaverM365Actions?.run_id, offboarding_id: record.id })
    } catch (_) {}

    showSuccess(`Approval request sent to ${approverName || approverEmail}`)
    await loadLeaverM365Actions(record.id)
    setLeaverM365ApprovalSending(false)
  }

  async function leaverM365ProceedRun(record: OffboardRecord) {
    if (!leaverM365Actions?.run_id) return
    setLeaverM365Proceeding(true)
    const approvedByRaw = leaverM365Actions.approved_by || ''
    const emailMatch = approvedByRaw.match(/<([^>]+)>/)
    const approverEmail = emailMatch ? emailMatch[1] : approvedByRaw
    const approverName = emailMatch ? approvedByRaw.replace(/<[^>]+>/, '').trim() : approvedByRaw
    const result = await callIfoLeaver('proceed-leaver-run', {
      run_id: leaverM365Actions.run_id,
      offboarding_id: record.id,
      approver_name: approverName,
      approver_email: approverEmail,
      approved_at: leaverM365Actions.approved_at,
      attempt: (leaverM365Actions?.attempt_count_run || 0) + 1,
    })
    setLeaverM365Proceeding(false)
    if (result) {
      if (result.status === 'completed') {
        showSuccess('M365 offboarding complete')
      } else if (result.status === 'awaiting_approval' || result.status === 'deprovisioning' || result.status === 'checking_account') {
        showSuccess(result.status === 'awaiting_approval' ? 'Approval submitted — processing offboarding...' : 'Deprovisioning started — polling for completion...')
        leaverM365PollRun(leaverM365Actions.run_id, record.id)
        return
      } else if (result.status === 'failed') {
        showError(result.friendlyError || 'Offboarding failed')
      }
      await loadLeaverM365Actions(record.id)
    }
  }

  async function leaverM365MarkCompleteManual(offboardingId: number) {
    const result = await callIfoLeaver('mark-leaver-complete-manual', { offboarding_id: offboardingId })
    if (result) {
      showSuccess('Marked as manually completed')
      await loadLeaverM365Actions(offboardingId)
    }
  }

  async function leaverSendScheduleApproval(record: OffboardRecord) {
    if (!selectedCompanyId || !ifoOffboardSettings) return
    if (!record.employee_email) { showError('Cannot schedule — employee has no email address set'); return }
    if (!record.end_date) { showError('Cannot schedule — no leave date set on this offboarding record'); return }
    setLeaverM365ApprovalSending(true)
    const leaveDate = record.end_date
    const removalDate = new Date(new Date(leaveDate).getTime() + leaverLicenceRemovalDays * 86400000)
    const planDesc = `Schedule M365 Offboarding for ${record.employee_name}:\n` +
      `• Block access: ${new Date(leaveDate).toLocaleDateString('en-GB')} at 17:00\n` +
      `• Remove groups & licence: ${removalDate.toLocaleDateString('en-GB')} at 17:00`
    let resolvedMode = ifoOffboardSettings.offboard_approver_mode
    let approverEmail: string | null = null
    if (resolvedMode === 'same_as_joiner') {
      resolvedMode = ifoOffboardSettings.approver_mode
      approverEmail = ifoOffboardSettings.approver_email
    } else if (resolvedMode === 'nominated') {
      approverEmail = ifoOffboardSettings.offboard_approver_email
    }
    if (resolvedMode === 'manager') {
      const { data: emp } = await supabase.from('employees').select('manager_email').eq('id', record.employee_id).maybeSingle()
      approverEmail = emp?.manager_email || null
    }
    if (!approverEmail) { showError('No approver found. Check the approver settings on the Integrations page.'); setLeaverM365ApprovalSending(false); return }
    const { error: wtErr } = await supabase.from('workflow_tracker').insert({
      company_id: selectedCompanyId,
      onboard_id: record.id,
      record_type: 'M365 Leaver Scheduling',
      action: 'Approve',
      task_description: planDesc,
      emp_display_name: record.employee_name,
      employee_email: approverEmail,
      assigned_to: approverEmail,
      status: 'Pending',
      approval_status: 'pending',
    })
    if (wtErr) { showError(`Failed to create approval task: ${wtErr.message}`); setLeaverM365ApprovalSending(false); return }
    const { data: approverEmp } = await supabase.from('employees').select('id').eq('company_id', selectedCompanyId).or(`user_email.eq.${approverEmail},email.eq.${approverEmail}`).maybeSingle()
    if (approverEmp) {
      await supabase.from('notifications').insert({
        company_id: selectedCompanyId,
        employee_id: approverEmp.id,
        type: 'action',
        notification_type: 'm365_leaver_schedule_approval',
        title: 'M365 Leaver Schedule Approval Required',
        message: `Please approve the M365 offboarding schedule for ${record.employee_name}.`,
        send_email: true,
        action_type: 'M365 Leaver Scheduling',
        action_record_id: record.id,
      })
    }
    const { error: upsertErr } = await supabase.from('offboarding_m365_actions').upsert({
      offboarding_id: record.id,
      company_id: selectedCompanyId,
      approval_sent_at: new Date().toISOString(),
      approval_status: 'pending',
      schedule_status: 'pending_approval',
      schedule_options: { licenceRemovalDelayDays: leaverLicenceRemovalDays },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'offboarding_id' })
    if (upsertErr) { showError(`Failed to save schedule status: ${upsertErr.message}`); setLeaverM365ApprovalSending(false); return }
    showSuccess('Schedule approval sent')
    setLeaverM365ApprovalSending(false)
    await loadLeaverM365Actions(record.id)
  }

  async function leaverCreateSchedule(record: OffboardRecord) {
    if (!selectedCompanyId || !leaverM365Actions) return
    if (!record.employee_email) { showError('Cannot create schedule — employee has no email address set'); return }
    if (!record.end_date) { showError('Cannot create schedule — no leave date set on this offboarding record'); return }
    setLeaverScheduleCreating(true)
    const result = await callIfoLeaver('create-leaver-schedule', {
      offboarding_id: record.id,
      user_principal_name: record.employee_email,
      display_name: record.employee_name,
      leave_date: record.end_date,
      options: { licenceRemovalDelayDays: leaverM365Actions.schedule_options?.licenceRemovalDelayDays || leaverLicenceRemovalDays },
      approver_name: leaverM365Actions.approved_by || 'InflowHR Approver',
      approver_email: ifoOffboardSettings?.offboard_approver_email || ifoOffboardSettings?.approver_email || '',
      approved_at: leaverM365Actions.approved_at || new Date().toISOString(),
      attempt: leaverM365Actions.attempt_count_run || 0,
    })
    setLeaverScheduleCreating(false)
    if (result) {
      if (result.use_run_now) {
        showError(result.error || 'Leave date is too close — use Run Now instead')
        setLeaverScheduleMode('now')
      } else {
        showSuccess(result.recovered ? 'Existing leaver schedule synced' : 'Leaver schedule created')
        if (result.id && leaverM365Actions) {
          setLeaverM365Actions({ ...leaverM365Actions, schedule_id: result.id, schedule_status: result.status || 'scheduled', schedule_message: result.message, schedule_stages: result.stages, schedule_next_due_at: result.nextDueAt })
        }
      }
      await loadLeaverM365Actions(record.id)
    }
  }

  async function leaverCancelSchedule(scheduleId: string, offboardingId: number, reason: string) {
    if (!confirm('Cancel this schedule? The engine will release any reserved resources.')) return
    setLeaverScheduleCancelling(true)
    const result = await callIfoLeaver('cancel-leaver-schedule', { schedule_id: scheduleId, offboarding_id: offboardingId, reason })
    setLeaverScheduleCancelling(false)
    if (result) {
      showSuccess('Schedule cancelled')
      await loadLeaverM365Actions(offboardingId)
    }
  }

  async function leaverRecheckSchedule(scheduleId: string, offboardingId: number) {
    setLeaverScheduleRefreshing(true)
    const result = await callIfoLeaver('recheck-leaver-schedule', { schedule_id: scheduleId, offboarding_id: offboardingId })
    setLeaverScheduleRefreshing(false)
    if (result) {
      showSuccess('Schedule rechecked')
      await loadLeaverM365Actions(offboardingId)
    }
  }

  function openWorkflow(record: OnboardRecord) {
    setSelectedId(record.id)
    const checks: Record<string, boolean> = {
      details: true,
      equipment: record.equipment_order === 'Y',
      meeting: record.first_day,
      notify_manager: record.first_day,
      plan_day1: record.first_day,
      inform_starter: record.first_week,
      accounts: record.elearning,
      day1_access: record.is_complete,
    }
    const customCompleted = record.custom_steps_completed || {}
    Object.keys(customCompleted).forEach(k => { if (customCompleted[k]) checks[k] = true })
    setStepChecks(checks)
    const skipped = record.skipped_steps
    setStepSkips(skipped && typeof skipped === 'object' ? skipped : {})
    const doneCount = activeSteps.filter(s => {
      return checks[s.step_key] || (skipped && skipped[s.step_key])
    }).length
    setWorkflowStep(record.is_complete ? activeSteps.length - 1 : Math.min(doneCount, activeSteps.length - 1))
    setTab('workflow')
    if (features.inflowonboarder_integration) {
      setM365Actions(null)
      const domain = ifoSettings?.account_domain
      setM365Upn(domain ? `${record.firstname.toLowerCase()}.${record.surname.toLowerCase()}@${domain}` : record.user_email)
      setM365DisplayName(`${record.firstname} ${record.surname}`)
      setM365Location('GB')
      loadM365Actions(record.id)
    }
    loadWorkflowDetails(record.id)
  }

  async function loadWorkflowDetails(onboardingId: number) {
    if (!selectedCompanyId) return
    const { data: checklist } = await supabase.from('onboard_step_checklist')
      .select('*').eq('company_id', selectedCompanyId).order('sort_order')
    if (checklist) setStepChecklist(checklist)

    const { data: onb } = await supabase.from('onboarding')
      .select('step_checklist_completed, step_assignments')
      .eq('id', onboardingId).maybeSingle()
    if (onb) {
      setStepChecklistCompleted(onb.step_checklist_completed || {})
      setStepAssignments(onb.step_assignments || {})
    }

    const { data: logs } = await supabase.from('onboard_activity_log')
      .select('*').eq('onboarding_id', onboardingId).order('created_at', { ascending: false }).limit(100)
    if (logs) setActivityLog(logs)
  }

  async function logActivity(stepKey: string, action: string, detail?: string) {
    if (!selectedId || !selectedCompanyId) return
    const actorName = session?.user?.user_metadata?.full_name || session?.user?.email || 'System'
    const actorEmail = session?.user?.email || null
    const entry = {
      company_id: selectedCompanyId,
      onboarding_id: selectedId,
      step_key: stepKey,
      action,
      actor_name: actorName,
      actor_email: actorEmail,
      detail: detail || null,
    }
    const { data } = await supabase.from('onboard_activity_log').insert(entry).select().maybeSingle()
    if (data) setActivityLog(prev => [data, ...prev])
  }

  async function toggleChecklistItem(stepKey: string, itemId: number) {
    if (!selectedId) return
    const current = stepChecklistCompleted[stepKey] || {}
    const newVal = !current[itemId]
    const updated = { ...stepChecklistCompleted, [stepKey]: { ...current, [itemId]: newVal } }
    setStepChecklistCompleted(updated)
    await supabase.from('onboarding').update({ step_checklist_completed: updated }).eq('id', selectedId)
    const item = stepChecklist.find(c => c.id === itemId)
    if (item) logActivity(stepKey, newVal ? 'Checklist item completed' : 'Checklist item unchecked', item.label)
  }

  async function reassignStep(stepKey: string, newAssignee: string) {
    if (!selectedId) return
    const updated = { ...stepAssignments, [stepKey]: { ...stepAssignments[stepKey], assigned_to: newAssignee } }
    setStepAssignments(updated)
    await supabase.from('onboarding').update({ step_assignments: updated }).eq('id', selectedId)
    logActivity(stepKey, 'Reassigned', `Assigned to ${newAssignee}`)
    setReassignStepKey(null)
    setReassignStepEmail('')
    showSuccess('Step reassigned')
  }

  function getStepDueDate(step: CustomStep, record: OnboardRecord): Date | null {
    const assignment = stepAssignments[step.step_key]
    if (assignment?.due_date) return new Date(assignment.due_date)
    if (!record.start_date) return null
    const offsetDays = (step as any).due_offset_days
    if (typeof offsetDays !== 'number') return null
    const d = new Date(record.start_date)
    d.setDate(d.getDate() + offsetDays)
    return d
  }

  function getStepAssignedTo(step: CustomStep, record: OnboardRecord): string {
    const assignment = stepAssignments[step.step_key]
    if (assignment?.assigned_to) return assignment.assigned_to
    return record.manager || 'Manager'
  }

  async function completeStep(stepKey: string) {
    setStepChecks(prev => ({ ...prev, [stepKey]: true }))
    setStepSkips(prev => ({ ...prev, [stepKey]: false }))
    const record = records.find(r => r.id === selectedId)
    if (!record) return
    const updates: Record<string, any> = {}
    if (stepKey === 'equipment') {
      updates.equipment_order = 'Y'
      if (record.user_email && selectedCompanyId) {
        await supabase.from('employees').update({ has_company_device: true }).eq('email', record.user_email).eq('company_id', selectedCompanyId)
      }
    }
    if (stepKey === 'plan_day1' || stepKey === 'meeting' || stepKey === 'notify_manager') updates.first_day = true
    if (stepKey === 'inform_starter') updates.first_week = true
    if (stepKey === 'assign_elearning' && selectedCompanyId) {
      const { data: companyData } = await supabase.from('companies')
        .select('new_starter_elearning_enabled, new_starter_course_id')
        .eq('id', selectedCompanyId).single()
      if (companyData?.new_starter_elearning_enabled && companyData.new_starter_course_id) {
        const { data: emp } = await supabase.from('employees')
          .select('id').eq('email', record.user_email).eq('company_id', selectedCompanyId).maybeSingle()
        if (emp) {
          await supabase.from('course_enrolments').upsert({
            company_id: selectedCompanyId,
            employee_id: emp.id,
            course_id: companyData.new_starter_course_id,
            status: 'not_started',
            progress_pct: 0,
            enrolled_at: record.start_date ? new Date(record.start_date).toISOString() : new Date().toISOString(),
          }, { onConflict: 'company_id,employee_id,course_id' })
          showSuccess('New starter e-learning course assigned')
        }
      } else if (!companyData?.new_starter_elearning_enabled) {
        showSuccess('New starter e-learning not enabled — step marked complete')
      } else {
        showError('No new starter course configured — configure one in E-Learning settings')
      }
    }
    if (stepKey === 'accounts') {
      const created = await createEmployeeFromOnboard(record)
      if (!created) return
      updates.elearning = true
    }
    // Check if all preparation-phase steps are now done (activate account at that point)
    const prepSteps = activeSteps.filter(s => s.step_config?.phase !== 'post_join')
    const newChecks = { ...stepChecks, [stepKey]: true }
    const newSkipsForCheck = { ...stepSkips, [stepKey]: false }
    const allPrepDone = prepSteps.every(s => newChecks[s.step_key] || newSkipsForCheck[s.step_key])
    const wasPrepDone = prepSteps.every(s => (s.step_key === stepKey ? false : stepChecks[s.step_key]) || stepSkips[s.step_key])

    if (allPrepDone && !wasPrepDone) {
      updates.is_complete = true; updates.status = 'Onboarded'; updates.appstatus = 'active'
      let { data: emp } = await supabase.from('employees').select('id').eq('email', record.user_email).eq('company_id', selectedCompanyId).maybeSingle()
      if (!emp) {
        const created = await createEmployeeFromOnboard(record)
        if (!created) return
        const { data: newEmp } = await supabase.from('employees').select('id').eq('email', record.user_email).eq('company_id', selectedCompanyId).maybeSingle()
        emp = newEmp
      }
      const activatePayload: Record<string, any> = { is_active: true }
      if ((record as any).user_persona) activatePayload.persona = (record as any).user_persona
      const { error: activateErr } = await supabase.from('employees').update(activatePayload).eq('email', record.user_email).eq('company_id', selectedCompanyId)
      if (activateErr) { showError('Failed to activate employee: ' + activateErr.message); return }
      if (emp) {
        const { data: existingCu } = await supabase.from('company_users').select('id').eq('employee_id', emp.id).eq('company_id', selectedCompanyId).maybeSingle()
        if (!existingCu) {
          await supabase.from('company_users').insert({
            company_id: selectedCompanyId,
            employee_id: emp.id,
            role: 'employee',
            is_active: true,
          })
        }
        if (features.skills_passport) {
          await supabase.from('workflow_tracker').insert({
            company_id: selectedCompanyId,
            emp_display_name: `${record.firstname} ${record.surname}`,
            step: 1,
            status: 'Pending',
            record_type: 'Skills Mapping',
            action: 'Complete your skills passport',
            employee_email: record.user_email,
            assigned_to: record.user_email,
            task_description: 'Complete your skills passport — add your skills, certifications and career goals to help your organisation understand your capabilities.',
          })
        }
      }
    }
    if (stepKey === 'assign_elearning') {
      const existing = record.custom_steps_completed || {}
      updates.custom_steps_completed = { ...existing, assign_elearning: true }
    }
    if (!updates.status) updates.status = 'in-progress'
    const newSkips = { ...stepSkips, [stepKey]: false }
    updates.skipped_steps = newSkips
    updateOnboardStatus(record.id, updates)
    logActivity(stepKey, 'Marked complete')
    if (workflowStep < activeSteps.length - 1) setWorkflowStep(workflowStep + 1)
  }

  function skipStep(stepKey: string) {
    setStepSkips(prev => ({ ...prev, [stepKey]: true }))
    const record = records.find(r => r.id === selectedId)
    if (!record) return
    const newSkips = { ...stepSkips, [stepKey]: true }
    updateOnboardStatus(record.id, { skipped_steps: newSkips, status: 'in-progress' })
    logActivity(stepKey, 'Skipped')
    if (workflowStep < WORKFLOW_STEPS.length - 1) setWorkflowStep(workflowStep + 1)
  }

  function uncompleteStep(stepKey: string) {
    setStepChecks(prev => ({ ...prev, [stepKey]: false }))
    setStepSkips(prev => ({ ...prev, [stepKey]: false }))
    logActivity(stepKey, 'Undone')
  }

  async function createEmployeeFromOnboard(record: OnboardRecord): Promise<boolean> {
    const niErr = validateNINumber(record.ni_number || '')
    if (niErr) { showError(niErr); return false }
    const scErr = validateSortCode(record.bank_sort_code || '')
    if (scErr) { showError(scErr); return false }
    const acErr = validateAccountNumber(record.bank_account_number || '')
    if (acErr) { showError(acErr); return false }
    const emailToUse = record.user_email || `${(record.employee_number || 'emp').toLowerCase()}@nonsso.local`
    const { data: existing } = await supabase.from('employees').select('id').eq('email', emailToUse).eq('company_id', selectedCompanyId).maybeSingle()
    if (existing) return true
    let empNum = record.employee_number || `EMP-${Date.now().toString().slice(-8)}`
    const { data: numClash } = await supabase.from('employees').select('id').eq('employee_number', empNum).eq('company_id', selectedCompanyId).maybeSingle()
    if (numClash) empNum = `EMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const uniqueEid = isNonSso ? (record.employee_number || empNum) : null
    const { data: newEmp, error } = await supabase.from('employees').insert({
      employee_number: empNum,
      first_name: record.firstname,
      last_name: record.surname,
      email: emailToUse,
      unique_employee_id: uniqueEid,
      job_title: record.job_title || '',
      department: record.department || '',
      start_date: record.start_date || toLocalDateStr(),
      phone: record.telephone || '',
      is_admin: false,
      is_active: false,
      company_id: selectedCompanyId,
      location: record.location || '',
      contract_type: record.contract_type || '',
      employment_category: record.employment_category || 'employed',
      personal_email: record.personal_email || '',
      manager_name: record.manager || '',
      manager_email: record.manager_email || '',
      date_of_birth: record.date_of_birth || null,
      gender: record.gender || null,
      nationality: record.nationality || null,
      marital_status: record.marital_status || null,
      address_line1: record.address_line1 || null,
      address_line2: record.address_line2 || null,
      city: record.city || null,
      county: record.county || null,
      postcode: record.postcode || null,
      country: record.country || null,
      emergency_contact_name: record.emergency_contact_name || null,
      emergency_contact_phone: record.emergency_contact_phone || null,
      emergency_contact_relationship: record.emergency_contact_relationship || null,
      ni_number: record.ni_number || null,
      bank_sort_code: record.bank_sort_code || null,
      bank_account_number: record.bank_account_number || null,
      bank_account_name: record.bank_account_name || null,
      probation_end_date: record.probation_end_date || null,
      notice_period: record.notice_period || null,
      weekly_hours: record.weekly_hours || null,
      annual_salary: record.annual_salary || null,
      tax_code: record.tax_code || null,
      payroll_id: record.payroll_id || null,
      leave_allowance: record.leave_allowance ?? 15,
      persona: (record as any).user_persona || 'information-worker',
    }).select('id').single()
    if (error) {
      showError(`Failed to create employee record: ${error.message}`)
      return false
    }

    if (newEmp) {
      const isZh = record.employment_category === 'shift_worker' && record.contract_type === 'Zero hours shift worker'
      const allowance = isZh ? 0 : (record.leave_allowance ?? 15)
      const { data: leaveTypes } = await supabase.from('leave_types').select('id, name, deducts_from_allowance').eq('company_id', selectedCompanyId)
      if (leaveTypes && leaveTypes.length > 0) {
        const year = new Date().getFullYear()
        const balances = leaveTypes.map(lt => {
          const bal: Record<string, unknown> = {
            employee_id: newEmp.id,
            leave_type_id: lt.id,
            year,
            total_allowance: lt.deducts_from_allowance ? allowance : 0,
            used: 0,
            carried_over: 0,
            company_id: selectedCompanyId,
          }
          if (isZh && lt.name === 'Annual Leave') bal.accrual_unit = 'hours'
          return bal
        })
        await supabase.from('leave_balances').insert(balances)
      }
    }

    return true
  }

  const stats = useMemo(() => {
    const now = new Date()
    const today = toLocalDateStr(now)

    const fyStart = new Date(now.getFullYear(), fyStartMonth - 1, 1)
    if (fyStart > now) fyStart.setFullYear(fyStart.getFullYear() - 1)
    const fyEnd = new Date(fyStart.getFullYear() + 1, fyStart.getMonth(), 0)

    const fyRecords = records.filter(r => {
      if (!r.start_date) return false
      return r.start_date >= toLocalDateStr(fyStart) && r.start_date <= toLocalDateStr(fyEnd)
    })

    const monthNames = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
    const monthlyBreakdown = monthNames.map((label, i) => {
      const m = (fyStartMonth - 1 + i) % 12
      const y = m < fyStartMonth - 1 ? fyStart.getFullYear() + 1 : fyStart.getFullYear()
      const count = fyRecords.filter(r => {
        const d = new Date(r.start_date)
        return d.getMonth() === m && d.getFullYear() === y
      }).length
      return { label, count }
    })

    const overdue = records.filter(r => !r.is_complete && r.start_date && r.start_date < today).length

    const stageMap: Record<string, number> = {}
    activeSteps.forEach(s => { stageMap[s.step_key] = 0 })
    stageMap['complete'] = 0
    records.filter(r => !r.is_complete).forEach(r => {
      const firstKey = activeSteps.length > 0 ? activeSteps[0].step_key : 'details'
      if (r.status === 'new') { stageMap[firstKey] = (stageMap[firstKey] || 0) + 1; return }
      const checks: Record<string, boolean> = {
        details: true, equipment: r.equipment_order === 'Y',
        meeting: r.first_day, notify_manager: r.first_day, plan_day1: r.first_day,
        inform_starter: r.first_week, assign_elearning: !!r.custom_steps_completed?.assign_elearning, accounts: r.elearning, day1_access: r.is_complete,
      }
      const skipped = r.skipped_steps
      const doneCount = activeSteps.filter(s => checks[s.step_key] || (skipped && skipped[s.step_key])).length
      const currentIdx = Math.min(doneCount, activeSteps.length - 1)
      const stepKey = activeSteps[currentIdx].step_key
      stageMap[stepKey] = (stageMap[stepKey] || 0) + 1
    })
    stageMap['complete'] = records.filter(r => r.is_complete).length

    return {
      total: records.length,
      fyTotal: fyRecords.length,
      pending: records.filter(r => !r.is_complete).length,
      dueJoining: records.filter(r => !r.is_complete && r.start_date && r.start_date > today).length,
      overdue,
      completed: records.filter(r => r.is_complete).length,
      monthlyBreakdown,
      stageMap,
      fyLabel: `${fyStart.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – ${fyEnd.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`,
    }
  }, [records, fyStartMonth, activeSteps])

  const filtered = useMemo(() => {
    if (!filterStatus) return records
    if (filterStatus === 'pending') return records.filter(r => !r.is_complete)
    if (filterStatus === 'completed') return records.filter(r => r.is_complete)
    return records.filter(r => r.status === filterStatus)
  }, [records, filterStatus])

  const onbTotalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginatedFiltered = filtered.slice((onbPage - 1) * PAGE_SIZE, onbPage * PAGE_SIZE)

  const activeOffboardRecords = useMemo(() => offboardRecords.filter(r => !r.is_complete), [offboardRecords])
  const offTotalPages = Math.max(1, Math.ceil(activeOffboardRecords.length / PAGE_SIZE))
  const paginatedActiveOffboard = activeOffboardRecords.slice((offPage - 1) * PAGE_SIZE, offPage * PAGE_SIZE)

  const frozenTotalPages = Math.max(1, Math.ceil(frozenEmployees.length / PAGE_SIZE))
  const paginatedFrozen = frozenEmployees.slice((frozenPage - 1) * PAGE_SIZE, frozenPage * PAGE_SIZE)

  const completedOffboardRecords = useMemo(() => offboardRecords.filter(r => r.is_complete), [offboardRecords])
  const complTotalPages = Math.max(1, Math.ceil(completedOffboardRecords.length / PAGE_SIZE))
  const paginatedCompletedOffboard = completedOffboardRecords.slice((complPage - 1) * PAGE_SIZE, complPage * PAGE_SIZE)

  const activeMoverRecords = useMemo(() => moverRecords.filter(r => !r.is_complete && r.status !== 'cancelled'), [moverRecords])
  const completedMoverRecords = useMemo(() => moverRecords.filter(r => r.is_complete || r.status === 'cancelled'), [moverRecords])
  const moverTotalPages = Math.max(1, Math.ceil(activeMoverRecords.length / PAGE_SIZE))
  const paginatedActiveMovers = activeMoverRecords.slice((moverPage - 1) * PAGE_SIZE, moverPage * PAGE_SIZE)

  const moverStats = useMemo(() => {
    const now = new Date()
    const fyStart = new Date(now.getFullYear(), fyStartMonth - 1, 1)
    if (fyStart > now) fyStart.setFullYear(fyStart.getFullYear() - 1)
    const fyEnd = new Date(fyStart.getFullYear() + 1, fyStart.getMonth(), 0)
    const fyRecs = moverRecords.filter(r => r.created_at >= toLocalDateStr(fyStart) && r.created_at <= toLocalDateStr(fyEnd))
    const personaChanges = moverRecords.filter(r => r.change_type === 'persona_change' || (r.changes?.persona))
    const monthNames = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
    const monthlyBreakdown = monthNames.map((label, i) => {
      const m = (fyStartMonth - 1 + i) % 12
      const y = m < fyStartMonth - 1 ? fyStart.getFullYear() + 1 : fyStart.getFullYear()
      const count = fyRecs.filter(r => { const d = new Date(r.created_at); return d.getMonth() === m && d.getFullYear() === y }).length
      return { label, count }
    })
    const statusMap: Record<string, number> = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 }
    moverRecords.forEach(r => { statusMap[r.status] = (statusMap[r.status] || 0) + 1 })
    return {
      total: moverRecords.length,
      fyTotal: fyRecs.length,
      inProgress: statusMap['in_progress'] || 0,
      personaChanges: personaChanges.length,
      completed: statusMap['completed'] || 0,
      pending: statusMap['pending'] || 0,
      monthlyBreakdown,
      statusMap,
      fyLabel: `${fyStart.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – ${fyEnd.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`,
    }
  }, [moverRecords, fyStartMonth])

  const selectedRecord = records.find(r => r.id === selectedId)

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Onboard / Offboard</h2>
        <p>{records.length} onboarding · {offboardRecords.filter(r => !r.is_complete).length} offboarding{features.inflowonboarder_integration && moverRecords.length > 0 ? ` · ${activeMoverRecords.length} movers` : ''}</p>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'dashboard' ? 'admin-tab-active' : ''}`} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button className={`admin-tab ${tab === 'new' ? 'admin-tab-active' : ''}`} onClick={() => setTab('new')}>New Starter</button>
        <button className={`admin-tab ${tab === 'upload' ? 'admin-tab-active' : ''}`} onClick={() => setTab('upload')}>Bulk Upload</button>
        <button className={`admin-tab ${tab === 'jml' ? 'admin-tab-active' : ''}`} onClick={() => setTab('jml')}>Joiners / Movers / Leavers</button>
        {selectedId && <button className={`admin-tab ${tab === 'workflow' ? 'admin-tab-active' : ''}`} onClick={() => setTab('workflow')}>Onboard Workflow</button>}
        {offboardSelectedId && <button className={`admin-tab ${tab === 'offboard-workflow' ? 'admin-tab-active' : ''}`} onClick={() => setTab('offboard-workflow')}>Offboard Workflow</button>}
        {features.inflowonboarder_integration && moverSelectedId && (
          <button className={`admin-tab ${tab === 'mover-workflow' ? 'admin-tab-active' : ''}`} onClick={() => setTab('mover-workflow')} style={{ borderColor: '#e65100', color: tab === 'mover-workflow' ? '#fff' : '#e65100', background: tab === 'mover-workflow' ? '#e65100' : undefined }}>Mover Workflow</button>
        )}
        <button className={`admin-tab ${tab === 'settings' ? 'admin-tab-active' : ''}`} onClick={() => { setTab('settings'); initEditingSteps(); loadCompanyContacts() }}>Settings</button>
        {isSuperAdmin && (
          <button className={`admin-tab ${tab === 'setup' ? 'admin-tab-active' : ''}`} onClick={() => setTab('setup')} style={{ borderColor: '#7b1fa2', color: tab === 'setup' ? '#fff' : '#7b1fa2', background: tab === 'setup' ? '#7b1fa2' : undefined }}>
            Company Setup
          </button>
        )}
      </div>

      {tab === 'dashboard' && (
        <div className="admin-onboard-dash">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14, marginBottom: 20 }}>
            {[
              { label: 'Total Starters', value: stats.total, color: '#4f46e5', bg: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)', icon: '👥' },
              { label: 'This FY', value: stats.fyTotal, color: '#0284c7', bg: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)', icon: '📊' },
              { label: 'In Progress', value: stats.pending, color: '#d97706', bg: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', icon: '⏳' },
              { label: 'Due to Join', value: stats.dueJoining, color: '#7c3aed', bg: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)', icon: '🗓️' },
              { label: 'Overdue', value: stats.overdue, color: stats.overdue > 0 ? '#dc2626' : '#16a34a', bg: stats.overdue > 0 ? 'linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)' : 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', icon: stats.overdue > 0 ? '🚨' : '✅' },
              { label: 'Completed', value: stats.completed, color: '#16a34a', bg: 'linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%)', icon: '🎉' },
            ].map((card, i) => (
              <div key={i} style={{
                background: card.bg, borderRadius: 14, padding: '16px 18px',
                border: `1px solid ${card.color}22`, position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 28, opacity: 0.2 }}>{card.icon}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: card.color, lineHeight: 1 }}>{card.value}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: card.color, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{card.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 20, marginTop: 24 }}>
            {/* Line Graph — Onboarders per Month */}
            {(() => {
              const data = stats.monthlyBreakdown
              const max = Math.max(...data.map(x => x.count), 1)
              const padTop = 28, padBot = 32, padLeft = 30, padRight = 16
              const w = 660, h = 220
              const chartW = w - padLeft - padRight, chartH = h - padTop - padBot
              const points = data.map((m, i) => ({
                x: padLeft + (i / (data.length - 1)) * chartW,
                y: padTop + chartH - (m.count / max) * chartH,
                count: m.count,
                label: m.label,
              }))
              const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
              const areaPath = `${linePath} L${points[points.length - 1].x},${padTop + chartH} L${points[0].x},${padTop + chartH} Z`
              const gridLines = Array.from({ length: 5 }, (_, i) => {
                const val = Math.round((max / 4) * i)
                const y = padTop + chartH - (val / max) * chartH
                return { y, val }
              })
              return (
                <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 14, padding: '20px 20px 16px', border: '1px solid var(--admin-border, #e0e0e0)' }}>
                  <h4 style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 700, color: 'var(--admin-text, #1e1e2d)' }}>Onboarders per Month</h4>
                  <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888' }}>{stats.fyLabel}</p>
                  <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
                    <defs>
                      <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.01" />
                      </linearGradient>
                    </defs>
                    {gridLines.map((g, i) => (
                      <g key={i}>
                        <line x1={padLeft} y1={g.y} x2={w - padRight} y2={g.y} stroke="#e5e7eb" strokeWidth="1" />
                        <text x={padLeft - 6} y={g.y + 4} textAnchor="end" fill="#aaa" fontSize="10">{g.val}</text>
                      </g>
                    ))}
                    <path d={areaPath} fill="url(#lineGrad)" />
                    <path d={linePath} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    {points.map((p, i) => (
                      <g key={i}>
                        <circle cx={p.x} cy={p.y} r={p.count > 0 ? 4 : 2.5} fill={p.count > 0 ? '#4f46e5' : '#cbd5e1'} stroke="#fff" strokeWidth="2" />
                        {p.count > 0 && <text x={p.x} y={p.y - 10} textAnchor="middle" fill="#4f46e5" fontSize="12" fontWeight="700">{p.count}</text>}
                        <text x={p.x} y={padTop + chartH + 18} textAnchor="middle" fill="#999" fontSize="12">{p.label}</text>
                      </g>
                    ))}
                  </svg>
                </div>
              )
            })()}

            {/* Horizontal Bar Chart — Pipeline */}
            {(() => {
              const pipelineData = [
                ...activeSteps.map(s => ({ label: s.label, icon: s.icon, count: stats.stageMap[s.step_key] || 0, color: '#4f46e5' })),
                { label: 'Completed', icon: '✅', count: stats.stageMap['complete'] || 0, color: '#16a34a' },
              ]
              const maxCount = Math.max(...pipelineData.map(d => d.count), 1)
              return (
                <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 14, padding: '20px 20px 16px', border: '1px solid var(--admin-border, #e0e0e0)' }}>
                  <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--admin-text, #1e1e2d)' }}>Onboarding Pipeline</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {pipelineData.map((d, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>{d.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: d.count > 0 ? 'var(--admin-text, #333)' : '#bbb', width: 120, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
                        <div style={{ flex: 1, height: 22, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                          <div style={{
                            height: '100%',
                            width: d.count > 0 ? `${Math.max((d.count / maxCount) * 100, 8)}%` : '0%',
                            background: d.color === '#16a34a'
                              ? 'linear-gradient(90deg, #16a34a 0%, #22c55e 100%)'
                              : `linear-gradient(90deg, #4f46e5 0%, #818cf8 100%)`,
                            borderRadius: 6,
                            transition: 'width 0.4s ease',
                          }} />
                          {d.count > 0 && (
                            <span style={{
                              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                              fontSize: 11, fontWeight: 700, color: (d.count / maxCount) > 0.5 ? '#fff' : d.color,
                            }}>{d.count}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>

          {stats.overdue > 0 && (
            <div style={{ marginTop: 20, background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 12, padding: 16 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#e65100' }}>Overdue Onboarding ({stats.overdue})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {records.filter(r => !r.is_complete && r.start_date && r.start_date < toLocalDateStr()).map(r => {
                  const daysOver = Math.floor((Date.now() - new Date(r.start_date).getTime()) / 86400000)
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, fontSize: 13, padding: '6px 0', borderBottom: '1px solid #ffe0b2' }}>
                      <span style={{ fontWeight: 600 }}>{r.firstname} {r.surname}</span>
                      <span style={{ color: '#666' }}>{r.job_title}</span>
                      <span style={{ marginLeft: 'auto', color: '#c62828', fontWeight: 600 }}>{daysOver} day{daysOver !== 1 ? 's' : ''} overdue</span>
                      <button className="admin-btn-sm admin-btn-save" onClick={() => openWorkflow(r)}>View</button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {features.inflowonboarder_integration && moverRecords.length > 0 && (<>
            <h3 style={{ margin: '32px 0 14px', fontSize: 17, fontWeight: 700, color: '#e65100' }}>Movers</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14, marginBottom: 20 }}>
              {[
                { label: 'Total Movers', value: moverStats.total, color: '#e65100', bg: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)', icon: '🔄' },
                { label: 'This FY', value: moverStats.fyTotal, color: '#ef6c00', bg: 'linear-gradient(135deg, #fff8e1 0%, #ffecb3 100%)', icon: '📊' },
                { label: 'In Progress', value: moverStats.inProgress, color: '#f57c00', bg: 'linear-gradient(135deg, #fff3e0 0%, #ffcc80 100%)', icon: '⏳' },
                { label: 'Persona Changes', value: moverStats.personaChanges, color: '#bf360c', bg: 'linear-gradient(135deg, #fbe9e7 0%, #ffccbc 100%)', icon: '🛡️' },
                { label: 'Completed', value: moverStats.completed, color: '#16a34a', bg: 'linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%)', icon: '✅' },
              ].map((card, i) => (
                <div key={i} style={{
                  background: card.bg, borderRadius: 14, padding: '16px 18px',
                  border: `1px solid ${card.color}22`, position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 28, opacity: 0.2 }}>{card.icon}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: card.color, lineHeight: 1 }}>{card.value}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: card.color, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{card.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 20, marginTop: 24 }}>
              {(() => {
                const data = moverStats.monthlyBreakdown
                const max = Math.max(...data.map(x => x.count), 1)
                const padTop = 28, padBot = 32, padLeft = 30, padRight = 16
                const w = 660, h = 220
                const chartW = w - padLeft - padRight, chartH = h - padTop - padBot
                const points = data.map((m, i) => ({
                  x: padLeft + (i / (data.length - 1)) * chartW,
                  y: padTop + chartH - (m.count / max) * chartH,
                  count: m.count, label: m.label,
                }))
                const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
                const areaPath = `${linePath} L${points[points.length - 1].x},${padTop + chartH} L${points[0].x},${padTop + chartH} Z`
                const gridLines = Array.from({ length: 5 }, (_, i) => {
                  const val = Math.round((max / 4) * i)
                  const y = padTop + chartH - (val / max) * chartH
                  return { y, val }
                })
                return (
                  <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 14, padding: '20px 20px 16px', border: '1px solid var(--admin-border, #e0e0e0)' }}>
                    <h4 style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 700, color: 'var(--admin-text, #1e1e2d)' }}>Movers per Month</h4>
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888' }}>{moverStats.fyLabel}</p>
                    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
                      <defs>
                        <linearGradient id="moverLineGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#e65100" stopOpacity="0.18" />
                          <stop offset="100%" stopColor="#e65100" stopOpacity="0.01" />
                        </linearGradient>
                      </defs>
                      {gridLines.map((g, i) => (
                        <g key={i}>
                          <line x1={padLeft} y1={g.y} x2={w - padRight} y2={g.y} stroke="#e5e7eb" strokeWidth="1" />
                          <text x={padLeft - 6} y={g.y + 4} textAnchor="end" fill="#aaa" fontSize="10">{g.val}</text>
                        </g>
                      ))}
                      <path d={areaPath} fill="url(#moverLineGrad)" />
                      <path d={linePath} fill="none" stroke="#e65100" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      {points.map((p, i) => (
                        <g key={i}>
                          <circle cx={p.x} cy={p.y} r={p.count > 0 ? 4 : 2.5} fill={p.count > 0 ? '#e65100' : '#cbd5e1'} stroke="#fff" strokeWidth="2" />
                          {p.count > 0 && <text x={p.x} y={p.y - 10} textAnchor="middle" fill="#e65100" fontSize="12" fontWeight="700">{p.count}</text>}
                          <text x={p.x} y={padTop + chartH + 18} textAnchor="middle" fill="#999" fontSize="12">{p.label}</text>
                        </g>
                      ))}
                    </svg>
                  </div>
                )
              })()}

              {(() => {
                const pipelineData = [
                  { label: 'Pending', icon: '📋', count: moverStats.pending, color: '#e65100' },
                  { label: 'In Progress', icon: '⏳', count: moverStats.inProgress, color: '#f57c00' },
                  { label: 'Completed', icon: '✅', count: moverStats.completed, color: '#16a34a' },
                  { label: 'Cancelled', icon: '🚫', count: moverStats.statusMap['cancelled'] || 0, color: '#9e9e9e' },
                ]
                const maxCount = Math.max(...pipelineData.map(d => d.count), 1)
                return (
                  <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 14, padding: '20px 20px 16px', border: '1px solid var(--admin-border, #e0e0e0)' }}>
                    <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--admin-text, #1e1e2d)' }}>Mover Pipeline</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {pipelineData.map((d, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>{d.icon}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: d.count > 0 ? 'var(--admin-text, #333)' : '#bbb', width: 120, flexShrink: 0 }}>{d.label}</span>
                          <div style={{ flex: 1, height: 22, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                            <div style={{
                              height: '100%',
                              width: d.count > 0 ? `${Math.max((d.count / maxCount) * 100, 8)}%` : '0%',
                              background: d.color === '#16a34a'
                                ? 'linear-gradient(90deg, #16a34a 0%, #22c55e 100%)'
                                : d.color === '#9e9e9e'
                                  ? 'linear-gradient(90deg, #9e9e9e 0%, #bdbdbd 100%)'
                                  : `linear-gradient(90deg, #e65100 0%, #ff9800 100%)`,
                              borderRadius: 6, transition: 'width 0.4s ease',
                            }} />
                            {d.count > 0 && (
                              <span style={{
                                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                                fontSize: 11, fontWeight: 700, color: (d.count / maxCount) > 0.5 ? '#fff' : d.color,
                              }}>{d.count}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </>)}
        </div>
      )}

      {tab === 'new' && (
        <div className="admin-add-form">
          <h3>Create New Starter</h3>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Basic Details</legend>
            <div className="admin-form-grid">
              {[
                { key: 'firstname', label: 'First Name *' }, { key: 'surname', label: 'Surname *' },
                ...(isNonSso
                  ? [{ key: 'employee_number', label: 'Unique Employee ID *' }]
                  : [{ key: 'user_email', label: 'Work Email *' }]
                ),
                { key: 'personal_email', label: 'Personal Email' },
                { key: 'job_title', label: 'Job Title' }, { key: 'department', label: 'Department' },
                { key: 'manager', label: 'Manager Name' }, { key: 'manager_email', label: 'Manager Email' },
                { key: 'location', label: 'Work Location' }, { key: 'telephone', label: 'Phone' },
                ...(isNonSso ? [] : [{ key: 'employee_number', label: 'Employee Number' }]),
              ].map(f => (
                <div key={f.key} className="admin-form-field">
                  <label>{f.label}</label>
                  <input className="admin-input" value={newForm[f.key]} onChange={e => setNewForm(p => ({...p, [f.key]: e.target.value}))} />
                </div>
              ))}
              <div className="admin-form-field">
                <label>Start Date</label>
                <input type="date" className="admin-input" value={newForm.start_date} onChange={e => setNewForm(p => ({...p, start_date: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Contract Type</label>
                <select className="admin-select" value={newForm.contract_type} onChange={e => setNewForm(p => ({...p, contract_type: e.target.value}))}>
                  <option>Full-time</option><option>Part-time</option><option>Contract</option><option>Apprentice</option><option>Intern</option><option>Guest</option>
                </select>
              </div>
              <div className="admin-form-field">
                <label>Employment Category</label>
                <select className="admin-select" value={newForm.employment_category === 'shift_worker' && newForm.contract_type === 'Zero hours shift worker' ? 'zero_hours' : newForm.employment_category} onChange={e => {
                  const val = e.target.value
                  if (val === 'zero_hours') {
                    setNewForm(p => ({...p, employment_category: 'shift_worker', contract_type: 'Zero hours shift worker', weekly_hours: '0', leave_allowance: '0'}))
                  } else if (val === 'shift_worker') {
                    setNewForm(p => ({...p, employment_category: 'shift_worker', contract_type: p.contract_type === 'Zero hours shift worker' ? 'Full-time' : p.contract_type, weekly_hours: p.weekly_hours === '0' ? '37.5' : p.weekly_hours, leave_allowance: p.leave_allowance === '0' ? '' : p.leave_allowance}))
                  } else {
                    setNewForm(p => ({...p, employment_category: val, weekly_hours: p.weekly_hours === '0' ? '37.5' : p.weekly_hours, leave_allowance: p.leave_allowance === '0' ? '' : p.leave_allowance}))
                  }
                }}>
                  <option value="employed">Employed (Salaried)</option>
                  <option value="shift_worker">Shift Worker</option>
                  <option value="zero_hours">Zero Hours</option>
                </select>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  {newForm.employment_category === 'employed'
                    ? 'Paid a fixed salary divided by pay period. Uses timesheets for time recording.'
                    : newForm.contract_type === 'Zero hours shift worker'
                      ? 'Zero hours — no guaranteed hours, paid per shift worked × hourly rate. Leave allowance and weekly hours set to 0.'
                      : 'Works scheduled shifts, paid based on hours worked × hourly rate.'
                  }
                </div>
                <div style={{ fontSize: 11, color: '#1565c0', marginTop: 2 }}>
                  Payroll settings for this category are configured in Admin → Employees → Payroll Settings.
                </div>
              </div>
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Personal Information</legend>
            <div className="admin-form-grid">
              <div className="admin-form-field">
                <label>Date of Birth</label>
                <input type="date" className="admin-input" value={newForm.date_of_birth} onChange={e => setNewForm(p => ({...p, date_of_birth: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Gender</label>
                <select className="admin-select" value={newForm.gender} onChange={e => setNewForm(p => ({...p, gender: e.target.value}))}>
                  <option value="">—</option><option>Male</option><option>Female</option><option>Non-binary</option><option>Prefer not to say</option>
                </select>
              </div>
              <div className="admin-form-field">
                <label>Nationality</label>
                <input className="admin-input" value={newForm.nationality} onChange={e => setNewForm(p => ({...p, nationality: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Marital Status</label>
                <select className="admin-select" value={newForm.marital_status} onChange={e => setNewForm(p => ({...p, marital_status: e.target.value}))}>
                  <option value="">—</option><option>Single</option><option>Married</option><option>Civil Partnership</option><option>Divorced</option><option>Widowed</option><option>Prefer not to say</option>
                </select>
              </div>
              <div className="admin-form-field">
                <label>NI Number</label>
                <input className="admin-input" value={newForm.ni_number} onChange={e => setNewForm(p => ({...p, ni_number: e.target.value}))} />
              </div>
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Address</legend>
            <div className="admin-form-grid">
              {[
                { key: 'address_line1', label: 'Address Line 1' }, { key: 'address_line2', label: 'Address Line 2' },
                { key: 'city', label: 'City' }, { key: 'county', label: 'County' },
                { key: 'postcode', label: 'Postcode' }, { key: 'country', label: 'Country' },
              ].map(f => (
                <div key={f.key} className="admin-form-field">
                  <label>{f.label}</label>
                  <input className="admin-input" value={newForm[f.key]} onChange={e => setNewForm(p => ({...p, [f.key]: e.target.value}))} />
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Employment</legend>
            <div className="admin-form-grid">
              <div className="admin-form-field">
                <label>Weekly Hours</label>
                <input type="number" step="0.5" className="admin-input" value={newForm.weekly_hours} onChange={e => setNewForm(p => ({...p, weekly_hours: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Probation End Date</label>
                <input type="date" className="admin-input" value={newForm.probation_end_date} onChange={e => setNewForm(p => ({...p, probation_end_date: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Notice Period</label>
                <input className="admin-input" placeholder="e.g. 1 month" value={newForm.notice_period} onChange={e => setNewForm(p => ({...p, notice_period: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Annual Salary ({currencySymbol(currency)})</label>
                <input type="number" className="admin-input" value={newForm.annual_salary} onChange={e => setNewForm(p => ({...p, annual_salary: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Tax Code</label>
                <input className="admin-input" value={newForm.tax_code} onChange={e => setNewForm(p => ({...p, tax_code: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>Payroll ID</label>
                <input className="admin-input" value={newForm.payroll_id} onChange={e => setNewForm(p => ({...p, payroll_id: e.target.value}))} />
              </div>
              <div className="admin-form-field">
                <label>{newForm.contract_type === 'Zero hours shift worker' ? 'Leave Allowance (hours — accrued)' : 'Leave Allowance (days)'}</label>
                <input type="number" className="admin-input" placeholder={newForm.contract_type === 'Zero hours shift worker' ? '0' : '15'} value={newForm.leave_allowance} onChange={e => setNewForm(p => ({...p, leave_allowance: e.target.value}))} readOnly={newForm.contract_type === 'Zero hours shift worker'} style={newForm.contract_type === 'Zero hours shift worker' ? { background: '#f5f5f5', cursor: 'default' } : {}} />
                {newForm.contract_type === 'Zero hours shift worker' && (
                  <div style={{ fontSize: 11, color: '#1565c0', marginTop: 2 }}>Zero hours workers start with 0 hours and accrue holiday based on hours worked.</div>
                )}
              </div>
            </div>
          </fieldset>
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Emergency Contact</legend>
            <div className="admin-form-grid">
              {[
                { key: 'emergency_contact_name', label: 'Contact Name' },
                { key: 'emergency_contact_phone', label: 'Contact Phone' },
                { key: 'emergency_contact_relationship', label: 'Relationship' },
              ].map(f => (
                <div key={f.key} className="admin-form-field">
                  <label>{f.label}</label>
                  <input className="admin-input" value={newForm[f.key]} onChange={e => setNewForm(p => ({...p, [f.key]: e.target.value}))} />
                </div>
              ))}
            </div>
          </fieldset>
          {features.inflowonboarder_integration && identityProvider !== 'google_workspace' && (
            <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <legend style={{ fontWeight: 700, fontSize: 13, color: '#e65100' }}>Persona</legend>
              <p style={{ fontSize: 12, color: '#666', margin: '0 0 12px' }}>
                Assign a security/access persona for this new starter's M365 account.
              </p>
              {enginePersonas.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {enginePersonas.map(ep => {
                    const colours = ENGINE_PERSONA_COLORS[ep.id] || { color: '#555', bg: '#f5f5f5' }
                    const sel = newForm.user_persona === ep.id
                    return (
                      <button key={ep.id} type="button" disabled={ep.ready === false}
                        onClick={() => setNewForm(f => ({...f, user_persona: ep.id}))}
                        style={{ padding: '10px 12px', borderRadius: 8, border: sel ? `2px solid ${colours.color}` : '1px solid #ddd', background: sel ? colours.bg : '#fafafa', cursor: ep.ready === false ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: ep.ready === false ? 0.5 : 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: sel ? colours.color : '#333' }}>{ep.name}</div>
                        {ep.description && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{ep.description}</div>}
                        {ep.ready === false && <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>Not ready — {ep.setup || 'set up in InflowOnboarder'}</div>}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#888' }}>
                  {enginePersonasLoaded ? 'No persona packs enabled in InflowOnboarder.' : 'Connect InflowOnboarder to load personas.'}
                </div>
              )}
            </fieldset>
          )}
          <fieldset style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <legend style={{ fontWeight: 700, fontSize: 13, color: '#1565c0' }}>Bank Details</legend>
            <div className="admin-form-grid">
              {[
                { key: 'bank_account_name', label: 'Account Name' },
                { key: 'bank_sort_code', label: 'Sort Code' },
                { key: 'bank_account_number', label: 'Account Number' },
              ].map(f => (
                <div key={f.key} className="admin-form-field">
                  <label>{f.label}</label>
                  <input className="admin-input" value={newForm[f.key]} onChange={e => setNewForm(p => ({...p, [f.key]: e.target.value}))} />
                </div>
              ))}
            </div>
          </fieldset>
          <button className="admin-btn admin-btn-primary" onClick={createStarter}>Create & Start Workflow</button>
        </div>
      )}

      {tab === 'upload' && (
        <div className="admin-add-form">
          <h3>Bulk Upload New Starters</h3>
          <p style={{ color: '#666', marginBottom: 16 }}>Upload an Excel file (.xlsx) to create multiple new starter records at once.</p>

          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <button className="admin-btn admin-btn-primary" onClick={generateBulkTemplate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download Template
            </button>
            <button className="admin-btn" style={{ background: '#43a047', color: '#fff' }} onClick={() => fileInputRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload Excel File
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileSelect} style={{ display: 'none' }} />
          </div>

          {uploadErrors.length > 0 && (
            <div style={{ background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <strong style={{ color: '#e65100' }}>Validation Errors ({uploadErrors.length})</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#bf360c', fontSize: 13 }}>
                {uploadErrors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
              <p style={{ fontSize: 13, color: '#e65100', marginTop: 8 }}>Fix these errors in your spreadsheet and re-upload.</p>
            </div>
          )}

          {uploadResult && (
            <div style={{ background: uploadResult.failed > 0 ? '#fff3e0' : '#e8f5e9', border: `1px solid ${uploadResult.failed > 0 ? '#ff9800' : '#43a047'}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <strong style={{ color: uploadResult.failed > 0 ? '#e65100' : '#2e7d32' }}>
                Upload Complete: {uploadResult.success} created{uploadResult.failed > 0 ? `, ${uploadResult.failed} failed` : ''}
              </strong>
            </div>
          )}

          {uploadRows.length > 0 && !uploadResult && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h4 style={{ margin: 0 }}>Preview ({uploadRows.length} row{uploadRows.length !== 1 ? 's' : ''})</h4>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="admin-btn" style={{ background: '#e0e0e0', color: '#333' }} onClick={clearUpload}>Clear</button>
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={submitUpload}
                    disabled={uploading || uploadErrors.length > 0}
                  >
                    {uploading ? 'Uploading...' : `Create ${uploadRows.length} Starter${uploadRows.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Name</th><th>{isNonSso ? 'Employee ID' : 'Work Email'}</th><th>Job Title</th>
                      <th>Department</th><th>Start Date</th><th>Contract</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadRows.map((row, i) => {
                      const hasError = !row.firstname || !row.surname || (isNonSso ? !row.employee_number : !row.user_email)
                      return (
                        <tr key={i} style={hasError ? { background: '#fff3e0' } : undefined}>
                          <td>{i + 1}</td>
                          <td><strong>{row.firstname} {row.surname}</strong></td>
                          <td>{isNonSso ? (row.employee_number || '—') : row.user_email}</td>
                          <td>{row.job_title || '—'}</td>
                          <td>{row.department || '—'}</td>
                          <td>{row.start_date || '—'}</td>
                          <td>{row.contract_type || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {uploadRows.length === 0 && !uploadResult && (
            <div style={{ border: '2px dashed #ccc', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: '#999', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" style={{ marginBottom: 8 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <p style={{ margin: 0, fontSize: 15 }}>Click to select an Excel file or use the button above</p>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>Accepts .xlsx files</p>
            </div>
          )}
        </div>
      )}

      {tab === 'jml' && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '2px solid var(--admin-border, #e0e0e0)' }}>
          <button onClick={() => setJmlSection('joiners')} style={{ padding: '10px 24px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', borderBottom: jmlSection === 'joiners' ? '3px solid #4f46e5' : '3px solid transparent', color: jmlSection === 'joiners' ? '#4f46e5' : '#666', background: 'none' }}>
            Joiners ({records.filter(r => !r.is_complete).length})
          </button>
          {features.inflowonboarder_integration && (
            <button onClick={() => setJmlSection('movers')} style={{ padding: '10px 24px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', borderBottom: jmlSection === 'movers' ? '3px solid #e65100' : '3px solid transparent', color: jmlSection === 'movers' ? '#e65100' : '#666', background: 'none' }}>
              Movers ({activeMoverRecords.length})
            </button>
          )}
          <button onClick={() => setJmlSection('leavers')} style={{ padding: '10px 24px', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', borderBottom: jmlSection === 'leavers' ? '3px solid #c62828' : '3px solid transparent', color: jmlSection === 'leavers' ? '#c62828' : '#666', background: 'none' }}>
            Leavers ({offboardRecords.filter(r => !r.is_complete).length})
          </button>
        </div>
      )}

      {tab === 'jml' && syncRecords.filter(r => r.status === 'needs_review').length > 0 && (
        <div style={{ background: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)', border: '1px solid #ff9800', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setSyncExpanded(!syncExpanded)}>
            <span style={{ fontWeight: 700, color: '#e65100', fontSize: 14 }}>
              {syncRecords.filter(r => r.status === 'needs_review').length} engine sync item{syncRecords.filter(r => r.status === 'needs_review').length !== 1 ? 's' : ''} need attention
            </span>
            <span style={{ color: '#e65100', fontSize: 12, fontWeight: 600 }}>{syncExpanded ? 'Hide' : 'Show details'}</span>
          </div>
          {syncExpanded && (
            <div style={{ marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ffcc80', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', color: '#bf360c' }}>Kind</th>
                    <th style={{ padding: '6px 8px', color: '#bf360c' }}>Ref</th>
                    <th style={{ padding: '6px 8px', color: '#bf360c' }}>Error</th>
                    <th style={{ padding: '6px 8px', color: '#bf360c' }}>Attempts</th>
                    <th style={{ padding: '6px 8px', color: '#bf360c' }}>Created</th>
                    <th style={{ padding: '6px 8px', color: '#bf360c' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {syncRecords.filter(r => r.status === 'needs_review').map(sr => (
                    <tr key={sr.id} style={{ borderBottom: '1px solid #ffe0b2' }}>
                      <td style={{ padding: '8px', textTransform: 'capitalize', fontWeight: 600 }}>{sr.kind}</td>
                      <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: 12 }}>{sr.external_ref}</td>
                      <td style={{ padding: '8px', color: '#c62828', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sr.last_error || ''}>{sr.last_error || '-'}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{sr.attempts}</td>
                      <td style={{ padding: '8px' }}>{sr.created_at ? toLocalDateStr(new Date(sr.created_at)) : '-'}</td>
                      <td style={{ padding: '8px' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button onClick={() => handleSyncRetry(sr.id)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #4caf50', background: '#e8f5e9', color: '#2e7d32', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Retry</button>
                          <input
                            type="text"
                            placeholder="Note (optional)"
                            value={syncDismissNote[sr.id] || ''}
                            onChange={e => setSyncDismissNote(prev => ({ ...prev, [sr.id]: e.target.value }))}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 12, width: 120 }}
                          />
                          <button onClick={() => handleSyncDismiss(sr.id)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #9e9e9e', background: '#f5f5f5', color: '#616161', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Dismiss</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {syncRecords.filter(r => ['pending', 'in_progress', 'failed'].includes(r.status)).length > 0 && (
                <p style={{ marginTop: 10, fontSize: 12, color: '#795548' }}>
                  {syncRecords.filter(r => ['pending', 'in_progress', 'failed'].includes(r.status)).length} additional sync record{syncRecords.filter(r => ['pending', 'in_progress', 'failed'].includes(r.status)).length !== 1 ? 's' : ''} processing automatically.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {(tab === 'list' || (tab === 'jml' && jmlSection === 'joiners')) && (
        <>
          <div className="admin-filters">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          {loading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Start Date</th><th>Status</th><th>Status Update</th><th>Progress</th><th>Actions</th></tr></thead>
                <tbody>
                  {paginatedFiltered.map(r => {
                    const skipped = r.skipped_steps || {}
                    const defaultDone = [true, r.equipment_order === 'Y', r.first_day, r.first_day, r.first_day, r.first_week, !!r.custom_steps_completed?.assign_elearning, r.elearning, r.is_complete].filter(Boolean).length
                    const skippedCount = Object.values(skipped).filter(Boolean).length
                    const customCompleted = (r as any).custom_steps_completed || {}
                    const customDoneCount = Object.values(customCompleted).filter(Boolean).length
                    const totalSteps = activeSteps.length
                    const totalDone = hasCustomSteps ? (defaultDone + customDoneCount + skippedCount) : (defaultDone + skippedCount)
                    const displayDone = Math.min(totalDone, totalSteps)
                    const isOffboarded = offboardRecords.some(o => o.employee_email === r.user_email && o.is_complete)
                    const isFrozen = frozenEmployees.some(f => f.employee_email === r.user_email && f.status !== 'recovered')
                    return (
                      <tr key={r.id}>
                        <td><strong>{r.firstname} {r.surname}</strong></td>
                        <td style={{ fontSize: 12, color: '#666' }}>{r.company?.name || '—'}</td>
                        <td>{r.job_title || '—'}</td>
                        <td>{r.start_date ? new Date(r.start_date).toLocaleDateString('en-GB') : '—'}</td>
                        <td><span className={`admin-badge ${r.is_complete ? 'admin-badge-approved' : 'admin-badge-pending'}`}>{r.is_complete ? 'Onboarded' : r.status}</span></td>
                        <td>{isFrozen ? <span style={{ color: '#1565c0', fontWeight: 600, fontSize: 12 }}>Frozen</span> : isOffboarded ? <span style={{ color: '#c62828', fontWeight: 600, fontSize: 12 }}>Offboarded</span> : '—'}</td>
                        <td>
                          <div className="admin-progress-bar"><div className="admin-progress-fill" style={{width: `${(displayDone / totalSteps) * 100}%`}} /></div>
                          <span className="admin-progress-text">{displayDone}/{totalSteps}{skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}</span>
                        </td>
                        <td className="admin-actions">
                          <button className="admin-btn-sm admin-btn-save" onClick={() => openWorkflow(r)}>Workflow</button>
                          <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteRecord(r.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="admin-empty">No onboarding records</div>}
              {onbTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button className="admin-action-btn" disabled={onbPage <= 1} onClick={() => setOnbPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13 }}>Page {onbPage} of {onbTotalPages}</span>
                  <button className="admin-action-btn" disabled={onbPage >= onbTotalPages} onClick={() => setOnbPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'workflow' && selectedRecord && (
        <div className="admin-wf-split">
          {/* ── LEFT SIDEBAR: Step list ── */}
          <div className="admin-wf-sidebar">
            <div className="admin-wf-sidebar-header">
              <h3>JOINER</h3>
              <h2>{selectedRecord.firstname} {selectedRecord.surname}</h2>
              <p className="admin-wf-role">{selectedRecord.job_title}</p>
              {(() => {
                const totalSteps = activeSteps.length
                const doneCount = activeSteps.filter(s => stepChecks[s.step_key] || stepSkips[s.step_key]).length
                const pct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0
                const pendingSteps = activeSteps.filter(s => !stepChecks[s.step_key] && !stepSkips[s.step_key])
                const dueSoon = pendingSteps.filter(s => {
                  const d = getStepDueDate(s, selectedRecord)
                  return d && d.getTime() <= Date.now() + 7 * 86400000
                }).length
                return (
                  <>
                    <div className="admin-wf-sidebar-progress-wrap">
                      <div className="admin-wf-sidebar-progress-fill" style={{ width: `${Math.max(pct, 8)}%` }} />
                      <div className="admin-wf-sidebar-progress-text">{doneCount}/{totalSteps}</div>
                    </div>
                    <div className="admin-wf-sidebar-meta">
                      <span>{dueSoon > 0 ? `${dueSoon} due in 7 days` : `${pendingSteps.length} remaining`}</span>
                      <span>Starts {selectedRecord.start_date ? new Date(selectedRecord.start_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'TBC'}</span>
                    </div>
                  </>
                )
              })()}
            </div>
            {(() => {
              const prepSteps = activeSteps.filter(s => s.step_config?.phase !== 'post_join')
              const postSteps = activeSteps.filter(s => s.step_config?.phase === 'post_join')
              const prepDone = prepSteps.filter(s => stepChecks[s.step_key] || stepSkips[s.step_key]).length
              const postDone = postSteps.filter(s => stepChecks[s.step_key] || stepSkips[s.step_key]).length
              return (
                <>
                  <div className="admin-wf-phase-group">
                    <div className="admin-wf-phase-header" onClick={() => setCollapsedPhases(p => ({ ...p, preparation: !p.preparation }))}>
                      <span>{collapsedPhases.preparation ? '▸' : '▾'} PREPARATION</span>
                      <span className="admin-wf-phase-badge">{prepDone}/{prepSteps.length}</span>
                    </div>
                    {!collapsedPhases.preparation && prepSteps.map((step, _idx) => {
                      const i = activeSteps.indexOf(step)
                      const done = stepChecks[step.step_key]
                      const skipped = stepSkips[step.step_key]
                      const dueDate = getStepDueDate(step, selectedRecord)
                      return (
                        <div key={step.step_key}
                          className={`admin-wf-step-row ${done ? 'done' : ''} ${skipped ? 'skipped' : ''} ${i === workflowStep ? 'active' : ''}`}
                          onClick={() => { setWorkflowStep(i); if (step.step_key === 'accounts' && selectedId && features.inflowonboarder_integration) loadM365Actions(selectedId) }}>
                          <div className="admin-wf-step-icon">{done ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg> : skipped ? '⏭' : ''}</div>
                          <span className="admin-wf-step-label">{step.label}</span>
                          {dueDate && <span className="admin-wf-step-date">{dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                        </div>
                      )
                    })}
                  </div>
                  {postSteps.length > 0 && (
                    <div className="admin-wf-phase-group">
                      <div className="admin-wf-phase-header" onClick={() => setCollapsedPhases(p => ({ ...p, post_join: !p.post_join }))}>
                        <span>{collapsedPhases.post_join ? '▸' : '▾'} POST-JOIN</span>
                        <span className="admin-wf-phase-badge" style={{ background: postDone === postSteps.length && postSteps.length > 0 ? '#3d5a3e' : '#8b8fa3' }}>{postDone}/{postSteps.length}</span>
                      </div>
                      {!collapsedPhases.post_join && postSteps.map(step => {
                        const i = activeSteps.indexOf(step)
                        const done = stepChecks[step.step_key]
                        const skipped = stepSkips[step.step_key]
                        const dueDate = getStepDueDate(step, selectedRecord)
                        return (
                          <div key={step.step_key}
                            className={`admin-wf-step-row ${done ? 'done' : ''} ${skipped ? 'skipped' : ''} ${i === workflowStep ? 'active' : ''}`}
                            onClick={() => { setWorkflowStep(i); if (step.step_key === 'accounts' && selectedId && features.inflowonboarder_integration) loadM365Actions(selectedId) }}>
                            <div className="admin-wf-step-icon">{done ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg> : skipped ? '⏭' : ''}</div>
                            <span className="admin-wf-step-label">{step.label}</span>
                            {dueDate && <span className="admin-wf-step-date">{dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )
            })()}
          </div>

          {/* ── RIGHT PANEL: Step detail ── */}
          <div className="admin-wf-detail-panel">
          {(() => {
            const currentStep = activeSteps[workflowStep]
            if (!currentStep) return null
            const step = currentStep
            const done = stepChecks[step.step_key]
            const skipped = stepSkips[step.step_key]
            const prepSteps = activeSteps.filter(s => s.step_config?.phase !== 'post_join')
            const postSteps = activeSteps.filter(s => s.step_config?.phase === 'post_join')
            const allPrepDone = prepSteps.every(s => stepChecks[s.step_key] || stepSkips[s.step_key])
            const phaseLabel = step.step_config?.phase === 'post_join' ? 'POST-JOIN' : 'PREPARATION'
            const phaseSteps = step.step_config?.phase === 'post_join' ? postSteps : prepSteps
            const stepIndexInPhase = phaseSteps.indexOf(step) + 1
            const dueDate = getStepDueDate(step, selectedRecord)
            const assignedTo = getStepAssignedTo(step, selectedRecord)
            const dependsOnKey = step.step_config?.requires_step
            const dependsOnLabel = dependsOnKey ? (activeSteps.find(s => s.step_key === dependsOnKey)?.label || 'Nothing') : 'Nothing'
            const checklistForStep = stepChecklist.filter(c => c.step_key === step.step_key)
            const checklistCompleted = stepChecklistCompleted[step.step_key] || {}
            const checklistDone = checklistForStep.filter(c => checklistCompleted[c.id]).length
            const stepLogs = activityLog.filter(l => l.step_key === step.step_key)

            const dueDaysAway = dueDate ? Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null

            return (
              <>
                <div className="admin-wf-detail-top">
                  <p className="admin-wf-detail-breadcrumb">{phaseLabel} · STEP {stepIndexInPhase} OF {phaseSteps.length}</p>
                  <h2 className="admin-wf-detail-title">{step.label}</h2>
                  {dueDate && (
                    <p className="admin-wf-detail-due">
                      Due <span className={dueDaysAway !== null && dueDaysAway < 0 ? 'overdue' : dueDaysAway !== null && dueDaysAway <= 3 ? 'due-soon' : 'due-date'}>
                        {dueDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </span>
                      {dueDaysAway !== null && (
                        <span style={{ marginLeft: 6, fontSize: 12 }}>
                          · {dueDaysAway < 0 ? `${Math.abs(dueDaysAway)} day${Math.abs(dueDaysAway) !== 1 ? 's' : ''} overdue` : dueDaysAway === 0 ? 'today' : `in ${dueDaysAway} day${dueDaysAway !== 1 ? 's' : ''}`}
                        </span>
                      )}
                    </p>
                  )}
                  <div className="admin-wf-detail-actions">
                    {done ? (
                      <>
                        <button className="admin-wf-detail-btn done-btn">✓ Completed</button>
                        <button className="admin-wf-detail-btn" onClick={() => uncompleteStep(step.step_key)}>Undo</button>
                      </>
                    ) : skipped ? (
                      <>
                        <button className="admin-wf-detail-btn primary" onClick={() => completeStep(step.step_key)}>Mark as done</button>
                        <button className="admin-wf-detail-btn" onClick={() => uncompleteStep(step.step_key)}>Undo Skip</button>
                      </>
                    ) : (
                      <>
                        <button className="admin-wf-detail-btn primary" onClick={() => completeStep(step.step_key)}>Mark as done</button>
                        {step.step_key !== 'details' && (
                          <button className="admin-wf-detail-btn" onClick={() => skipStep(step.step_key)}>Skip</button>
                        )}
                      </>
                    )}
                    <button className="admin-wf-detail-btn" onClick={() => {
                      const assignee = getStepAssignedTo(step, selectedRecord)
                      showSuccess(`Reminder sent to ${assignee}`)
                      logActivity(step.step_key, 'Reminder sent', `To ${assignee}`)
                    }}>Send reminder</button>
                    <button className="admin-wf-detail-btn" onClick={() => { setReassignStepKey(step.step_key); setReassignStepEmail(getStepAssignedTo(step, selectedRecord)) }}>Reassign</button>
                  </div>
                  {reassignStepKey === step.step_key && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                      <input type="text" value={reassignStepEmail} onChange={e => setReassignStepEmail(e.target.value)} placeholder="Name or email" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, flex: 1 }} />
                      <button className="admin-btn-sm admin-btn-save" onClick={() => reassignStep(step.step_key, reassignStepEmail)}>Save</button>
                      <button className="admin-btn-sm" onClick={() => setReassignStepKey(null)}>Cancel</button>
                    </div>
                  )}
                </div>

                <div className="admin-wf-detail-body">
                  {/* Metadata grid */}
                  <div className="admin-wf-meta-grid">
                    <div className="admin-wf-meta-item">
                      <label>TYPE</label>
                      {(() => { const tm = STEP_TYPE_META[step.step_config?.step_type || 'checklist']; return tm ? <span><span className="meta-icon">{tm.icon}</span><span style={{ color: tm.color }}>{tm.label}</span></span> : null })()}
                    </div>
                    <div className="admin-wf-meta-item">
                      <label>ASSIGNED TO</label>
                      <span>{assignedTo}</span>
                    </div>
                    <div className="admin-wf-meta-item">
                      <label>DUE</label>
                      <span>{dueDate ? dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</span>
                    </div>
                    <div className="admin-wf-meta-item">
                      <label>DEPENDS ON</label>
                      <span>{dependsOnLabel}</span>
                    </div>
                  </div>

                  {/* What Happens */}
                  <div className="admin-wf-detail-section">
                    <h5 className="admin-wf-detail-section-title">WHAT HAPPENS</h5>
                    <p className="admin-wf-whatbox">{step.description}</p>
                  </div>

                  {/* Send Notification / Meeting button */}
                  {(step.step_config?.notify_email || step.step_config?.notify_contact_key || step.step_config?.notify_starter) && selectedRecord && (
                    <div style={{ margin: '0 0 20px', padding: 10, border: '1px solid #c7d2fe', borderRadius: 8, background: '#eef2ff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#4338ca', fontWeight: 600 }}>
                          {STEP_TYPE_META[step.step_config.step_type || 'checklist']?.icon || '📋'} {STEP_TYPE_META[step.step_config.step_type || 'checklist']?.label || 'Task'}: {step.step_config.notify_starter ? `${selectedRecord.firstname} ${selectedRecord.surname}` : step.step_config.notify_contact_key ? (companyContacts.find(c => c.contact_key === step.step_config!.notify_contact_key)?.label || step.step_config.notify_contact_key) : step.step_config.notify_email}
                        </span>
                        {step.step_config.requires_step && (() => {
                          const reqDone = stepChecks[step.step_config.requires_step!]
                          return !reqDone ? <span style={{ fontSize: 11, color: '#dc2626' }}>Requires: {activeSteps.find(s => s.step_key === step.step_config!.requires_step)?.label || step.step_config.requires_step}</span> : null
                        })()}
                        <button
                          className="admin-btn-sm admin-btn-save"
                          disabled={stepNotifSending === step.step_key || (!!step.step_config.requires_step && !stepChecks[step.step_config.requires_step])}
                          onClick={async () => {
                            setStepNotifSending(step.step_key)
                            await sendStepNotification(step.step_config!, selectedRecord, step.label, 'onboarding')
                            setStepNotifSending(null)
                          }}
                          style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                          {stepNotifSending === step.step_key ? 'Sending...' : step.step_config.meeting ? '📅 Send Meeting Invite' : '📧 Send Notification'}
                        </button>
                      </div>
                      {step.step_config.meeting && (
                        <div style={{ marginTop: 6, fontSize: 11, color: '#6366f1' }}>
                          Meeting: {resolveStepPlaceholders(step.step_config.meeting.title || '', selectedRecord)} · Attendees: {step.step_config.meeting.attendees?.join(', ') || 'manager, starter'}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Survey assignment card */}
                  {step.step_config?.step_type === 'survey' && step.step_config?.survey_id && selectedRecord && !done && (
                    <div style={{ margin: '0 0 20px', padding: 12, border: '1px solid #99f6e4', borderRadius: 8, background: '#f0fdfa' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: '#0d9488', fontWeight: 600 }}>📊 Survey: {companySurveys.find(s => s.id === step.step_config!.survey_id)?.title || 'Unknown'}</span>
                        <button
                          className="admin-btn-sm admin-btn-save"
                          disabled={surveyAssigning === step.step_key}
                          onClick={async () => {
                            const ok = await assignSurveyToEmployee(step.step_config!.survey_id!, selectedRecord.user_email, `${selectedRecord.firstname} ${selectedRecord.surname}`, step.step_key)
                            if (ok) completeStep(step.step_key)
                          }}
                          style={{ fontSize: 12, padding: '4px 12px', background: '#0d9488' }}
                        >
                          {surveyAssigning === step.step_key ? 'Assigning...' : `📊 Assign to ${selectedRecord.firstname}`}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: '#115e59', marginTop: 4 }}>Assigns this survey to the employee and creates a pending response in their My Surveys page.</div>
                    </div>
                  )}

                  {/* E-Learning card */}
                  {step.step_key === 'assign_elearning' && !done && (
                    <div style={{ border: '1px solid #c7d2fe', borderRadius: 10, padding: 16, marginBottom: 20, background: '#eef2ff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#4338ca' }}>New Starter Course</span>
                      </div>
                      {newStarterCourseInfo?.enabled ? (
                        newStarterCourseInfo.course ? (
                          <div style={{ fontSize: 13 }}>
                            <div><strong>{newStarterCourseInfo.course.title}</strong></div>
                            <div style={{ color: '#666', marginTop: 4 }}>Type: {newStarterCourseInfo.course.type} · Duration: {newStarterCourseInfo.course.duration} · Deadline: {newStarterCourseInfo.course.days_to_complete || 7} days from start date</div>
                            <div style={{ color: '#666', marginTop: 4, fontSize: 12 }}>Completing this step will enrol the new starter and set their deadline.</div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 13, color: '#dc2626' }}>No course configured — go to E-Learning settings to set up a new starter course.</div>
                        )
                      ) : (
                        <div style={{ fontSize: 13, color: '#666' }}>New starter e-learning is not enabled for this company. Step will be marked complete without enrolment.</div>
                      )}
                    </div>
                  )}

                  {/* Google Workspace notice */}
                  {step.step_key === 'accounts' && identityProvider === 'google_workspace' && !done && (
                    <div style={{ border: '1px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 20, background: '#f5f5f5' }}>
                      <p style={{ margin: 0, fontSize: 13, color: '#666' }}>M365 provisioning is not available for Google Workspace companies. Create accounts manually.</p>
                    </div>
                  )}

                  {/* M365 Provisioning section */}
                  {step.step_key === 'accounts' && features.inflowonboarder_integration && ifoConnected && selectedRecord && !done && identityProvider !== 'google_workspace' && (
                    <div style={{ border: '1px solid #90caf9', borderRadius: 10, padding: 16, marginBottom: 20, background: 'rgba(232,242,255,.5)' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <svg width="20" height="20" viewBox="0 0 512 512"><rect width="512" height="512" rx="64" fill="#0078D4"/><circle cx="256" cy="256" r="100" fill="none" stroke="#fff" strokeWidth="32"/><circle cx="256" cy="256" r="16" fill="#fff"/></svg>
                        <strong style={{ fontSize: 14, color: '#0078D4' }}>Microsoft 365 Provisioning</strong>
                              {m365RunPolling && <span style={{ fontSize: 12, color: '#1976d2', marginLeft: 8 }}>Updating...</span>}
                            </div>

                            {/* V1 legacy starters */}
                            {m365Actions?.is_v1_legacy && (
                              <div style={{ background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10, marginBottom: 12 }}>
                                <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Legacy provisioning (v1)</p>
                                <p style={{ margin: '4px 0 8px', fontSize: 12, color: '#bf360c' }}>
                                  This starter was created before the automated workflow. Account: {m365Actions.m365_upn || 'unknown'}.
                                </p>
                                {m365Actions.run_status !== 'completed' && (
                                  <button className="admin-btn-sm" onClick={e => { e.stopPropagation(); m365MarkCompleteManual(selectedRecord.id) }}
                                    style={{ alignSelf: 'flex-start' }}>
                                    Mark Complete Manually
                                  </button>
                                )}
                                {m365Actions.run_status === 'completed' && (
                                  <p style={{ margin: 0, fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>Marked as complete</p>
                                )}
                              </div>
                            )}

                            {/* Function gating — joiners blocked */}
                            {!m365Actions?.is_v1_legacy && (!m365Actions || (!m365Actions.run_id && !m365Actions.run_status && !m365Actions.schedule_id && !m365Actions.schedule_status)) && ifoSettings?.functions_cache?.joiners && (!ifoSettings.functions_cache.joiners.enabled || ifoSettings.functions_cache.joiners.suspended || !ifoSettings.functions_cache.joiners.inPlan) && (
                              <div style={{ marginBottom: 12, padding: 12, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffe0b2' }}>
                                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e65100' }}>
                                  {ifoSettings.functions_cache.joiners.suspended ? 'Joiner provisioning is temporarily suspended' : !ifoSettings.functions_cache.joiners.enabled ? 'Joiner provisioning is switched off in InflowOnboarder' : 'Joiner provisioning requires the JML Management plan in InflowOnboarder'}
                                </p>
                                {ifoSettings.functions_cache.joiners.suspended && ifoSettings.functions_cache.joiners.suspendedReason && (
                                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>{ifoSettings.functions_cache.joiners.suspendedReason}</p>
                                )}
                              </div>
                            )}

                            {/* No run yet — start form or schedule */}
                            {!m365Actions?.is_v1_legacy && (!m365Actions || (!m365Actions.run_id && !m365Actions.run_status && !m365Actions.schedule_id && !m365Actions.schedule_status)) && !(ifoSettings?.functions_cache?.joiners && (!ifoSettings.functions_cache.joiners.enabled || ifoSettings.functions_cache.joiners.suspended || !ifoSettings.functions_cache.joiners.inPlan)) && (
                              <div style={{ marginBottom: 12 }}>
                                {m365SchedulingAvailable && (
                                  <div style={{ display: 'flex', gap: 0, marginBottom: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid #90caf9', width: 'fit-content' }}>
                                    <button onClick={e => { e.stopPropagation(); setM365ScheduleMode('now') }}
                                      style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                        background: m365ScheduleMode === 'now' ? '#0078D4' : '#fff', color: m365ScheduleMode === 'now' ? '#fff' : '#0078D4' }}>
                                      Run Now
                                    </button>
                                    <button onClick={e => { e.stopPropagation(); setM365ScheduleMode('schedule') }}
                                      style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                        background: m365ScheduleMode === 'schedule' ? '#0078D4' : '#fff', color: m365ScheduleMode === 'schedule' ? '#fff' : '#0078D4' }}>
                                      Schedule
                                    </button>
                                  </div>
                                )}
                                {m365ActiveProvisionCount > 0 && !skipLicence && (
                                  <div style={{ marginBottom: 10, padding: 10, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffe0b2' }}>
                                    <p style={{ margin: 0, fontSize: 12, color: '#e65100', fontWeight: 600 }}>
                                      {m365ActiveProvisionCount} other joiner{m365ActiveProvisionCount > 1 ? 's' : ''} {m365ActiveProvisionCount > 1 ? 'have' : 'has'} M365 provisioning in progress
                                    </p>
                                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                      If licence seats are limited, this joiner may be blocked until a seat becomes available. Check your M365 licence availability before proceeding.
                                    </p>
                                  </div>
                                )}
                                {(!m365SchedulingAvailable || m365ScheduleMode === 'now') && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>UPN (email)</label>
                                        <input className="admin-input" value={m365Upn} onChange={e => setM365Upn(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Display Name</label>
                                        <input className="admin-input" value={m365DisplayName} onChange={e => setM365DisplayName(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                    </div>
                                    <div style={{ width: 100 }}>
                                      <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Country</label>
                                      <input className="admin-input" value={m365Location} onChange={e => setM365Location(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} maxLength={2} />
                                    </div>
                                    {ifoSettings?.passes_ready && ifoSettings?.passes_available !== false && (
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                                        <input type="checkbox" checked={m365IssuePass} onChange={e => setM365IssuePass(e.target.checked)} />
                                        Give {selectedRecord.firstname} a first-day sign-in pass (collected once by {selectedRecord.manager || 'their manager'})
                                      </label>
                                    )}
                                    <button className="admin-btn-sm admin-btn-save" disabled={m365Starting || m365RunPolling || !m365Upn}
                                      onClick={e => { e.stopPropagation(); m365StartRun(selectedRecord) }}
                                      style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                      {m365Starting ? 'Starting...' : 'Start M365 Provisioning'}
                                    </button>
                                  </div>
                                )}
                                {m365SchedulingAvailable && m365ScheduleMode === 'schedule' && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>UPN (email)</label>
                                        <input className="admin-input" value={m365Upn} onChange={e => setM365Upn(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Display Name</label>
                                        <input className="admin-input" value={m365DisplayName} onChange={e => setM365DisplayName(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                      <div style={{ width: 100 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Country</label>
                                        <input className="admin-input" value={m365Location} onChange={e => setM365Location(e.target.value)} style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} maxLength={2} />
                                      </div>
                                      <div style={{ width: 160 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Prepare account on</label>
                                        <input className="admin-input" type="date"
                                          value={m365PrepareDate || (() => { const d = new Date(new Date(selectedRecord.start_date).getTime() - m365PrepareDays * 86400000); return d.toISOString().split('T')[0] })()}
                                          min={new Date().toISOString().split('T')[0]}
                                          max={new Date(new Date(selectedRecord.start_date).getTime() - 86400000).toISOString().split('T')[0]}
                                          onChange={e => { const v = e.target.value; setM365PrepareDate(v); if (v && selectedRecord.start_date) { const diff = Math.round((new Date(selectedRecord.start_date + 'T00:00:00').getTime() - new Date(v + 'T00:00:00').getTime()) / 86400000); setM365PrepareDays(Math.max(1, diff)) } }}
                                          style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                    </div>
                                    <div style={{ background: 'rgba(232,242,255,.5)', border: '1px solid #bbdefb', borderRadius: 6, padding: 10 }}>
                                      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#1565c0' }}>Schedule plan</p>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#e3f2fd', border: '1px solid #90caf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#1565c0', flexShrink: 0 }}>1</span>
                                          <span>Prepare account — <strong>{new Date(new Date(selectedRecord.start_date).getTime() - m365PrepareDays * 86400000).toLocaleDateString('en-GB')}</strong> at 09:00</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#e3f2fd', border: '1px solid #90caf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#1565c0', flexShrink: 0 }}>2</span>
                                          <span>Enable sign-in — <strong>{new Date(selectedRecord.start_date).toLocaleDateString('en-GB')}</strong> at 08:00</span>
                                        </div>
                                      </div>
                                    </div>
                                    <button className="admin-btn-sm admin-btn-save" disabled={m365ApprovalSending || !m365Upn}
                                      onClick={e => { e.stopPropagation(); m365SendScheduleApproval(selectedRecord) }}
                                      style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                      {m365ApprovalSending ? 'Sending...' : 'Send Schedule for Approval'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Schedule tracking panel */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.schedule_id && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                  <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                    background: m365Actions.schedule_status === 'scheduled' ? '#e3f2fd' : m365Actions.schedule_status === 'running' ? '#fff3e0' : m365Actions.schedule_status === 'completed' ? '#e8f5e9' : m365Actions.schedule_status === 'cancelled' ? '#fafafa' : m365Actions.schedule_status === 'failed' || m365Actions.schedule_status === 'missed' ? '#fce4ec' : m365Actions.schedule_status === 'blocked' ? '#fff8e1' : '#f5f5f5',
                                    color: m365Actions.schedule_status === 'scheduled' ? '#1565c0' : m365Actions.schedule_status === 'running' ? '#e65100' : m365Actions.schedule_status === 'completed' ? '#2e7d32' : m365Actions.schedule_status === 'cancelled' ? '#888' : m365Actions.schedule_status === 'failed' || m365Actions.schedule_status === 'missed' ? '#c62828' : m365Actions.schedule_status === 'blocked' ? '#f57f17' : '#666',
                                  }}>
                                    {m365Actions.schedule_status === 'scheduled' ? 'Scheduled' : m365Actions.schedule_status === 'running' ? 'Running' : m365Actions.schedule_status === 'completed' ? 'Completed' : m365Actions.schedule_status === 'cancelled' ? 'Cancelled' : m365Actions.schedule_status === 'failed' ? 'Failed' : m365Actions.schedule_status === 'blocked' ? 'Blocked' : (m365Actions.schedule_status || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                  </span>
                                  <span style={{ fontSize: 12, color: '#666', flex: 1 }}>
                                    {(() => {
                                      const stages = m365Actions.schedule_stages
                                      const s0Done = stages && Array.isArray(stages) && stages[0]?.status === 'done'
                                      if (m365Actions.schedule_status === 'scheduled' && s0Done) {
                                        const s0Date = stages[0].dueAt ? new Date(stages[0].dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
                                        const s1Date = stages[1]?.dueAt ? new Date(stages[1].dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
                                        return `Account created (sign-in off) on ${s0Date}${s1Date ? `; sign-in switches on ${s1Date}` : ''}`
                                      }
                                      if (m365Actions.schedule_status === 'scheduled' && m365Actions.schedule_next_due_at)
                                        return `Provisioning will run on ${new Date(m365Actions.schedule_next_due_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                                      if (m365Actions.schedule_status === 'scheduled') return 'Account provisioning is scheduled'
                                      if (m365Actions.schedule_status === 'running') return 'Account provisioning is in progress...'
                                      if (m365Actions.schedule_status === 'completed') return 'Account provisioning complete'
                                      if (m365Actions.schedule_status === 'cancelled') return 'This schedule was cancelled'
                                      if (m365Actions.schedule_status === 'failed') return 'Provisioning failed — you can create a new schedule'
                                      if (m365Actions.schedule_status === 'blocked') return 'Provisioning is blocked — check licence availability'
                                      return ''
                                    })()}
                                  </span>
                                  <button className="admin-btn-sm" style={{ padding: '2px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                                    disabled={m365ScheduleRefreshing}
                                    onClick={async e => { e.stopPropagation(); setM365ScheduleRefreshing(true); await callIfo('get-schedule', { schedule_id: m365Actions!.schedule_id!, onboarding_id: selectedRecord.id }); await loadM365Actions(selectedRecord.id); setM365ScheduleRefreshing(false) }}>
                                    {m365ScheduleRefreshing ? <><div style={{ width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> Updating...</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</>}
                                  </button>
                                </div>
                                {m365Actions.schedule_stages && Array.isArray(m365Actions.schedule_stages) && m365Actions.schedule_stages.filter((s: any) => s.name).length > 0 && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                                    {m365Actions.schedule_stages.filter((s: any) => s.name).map((stage: any, si: number) => {
                                      const stageDate = stage.dueAt || stage.scheduledAt
                                      const isDone = stage.status === 'done' || stage.status === 'completed'
                                      return (
                                        <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'rgba(255,255,255,.6)', borderRadius: 4, border: '1px solid #e0e0e0', flexWrap: 'wrap' }}>
                                          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                            background: isDone ? '#4caf50' : stage.status === 'running' ? '#ff9800' : stage.status === 'failed' ? '#f44336' : stage.status === 'skipped' ? '#bbb' : '#90caf9',
                                          }} />
                                          <span style={{ fontWeight: 600 }}>{stage.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                                          <span style={{ color: '#888' }}>{stageDate ? new Date(stageDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
                                          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500,
                                            color: isDone ? '#2e7d32' : stage.status === 'running' ? '#e65100' : stage.status === 'failed' ? '#c62828' : '#888',
                                          }}>{isDone ? 'Done' : stage.status === 'pending' ? 'Waiting' : (stage.status || '').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                                          {isDone && stage.result?.userPrincipalName && (
                                            <span style={{ width: '100%', fontSize: 11, color: '#4caf50', paddingLeft: 16 }}>Email: {stage.result.userPrincipalName}</span>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                                {m365Actions.schedule_message && !['completed', 'cancelled', 'failed'].includes(m365Actions.schedule_status || '') && (
                                  <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(227,242,253,.4)', borderRadius: 4, border: '1px solid #bbdefb', fontSize: 12, color: '#1565c0' }}>
                                    {m365Actions.schedule_message}
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {m365Actions.schedule_status === 'blocked' && (
                                    <button className="admin-btn-sm" disabled={m365ScheduleRefreshing}
                                      onClick={e => { e.stopPropagation(); m365RecheckSchedule(m365Actions!.schedule_id!, selectedRecord.id) }}>
                                      Check Again
                                    </button>
                                  )}
                                  {!['completed', 'cancelled', 'failed'].includes(m365Actions.schedule_status || '') && (
                                    <button className="admin-btn-sm admin-btn-cancel" disabled={m365ScheduleCancelling}
                                      onClick={e => { e.stopPropagation(); m365CancelSchedule(m365Actions!.schedule_id!, selectedRecord.id, 'Cancelled by admin') }}>
                                      {m365ScheduleCancelling ? 'Cancelling...' : 'Cancel Schedule'}
                                    </button>
                                  )}
                                  {['cancelled', 'failed'].includes(m365Actions.schedule_status || '') && (
                                    <button className="admin-btn-sm" style={{ background: '#0078D4', color: '#fff', border: 'none' }}
                                      onClick={async e => {
                                        e.stopPropagation()
                                        const { error } = await supabase.from('onboarding_m365_actions').update({
                                          schedule_id: null, schedule_status: 'pending_approval', schedule_message: null,
                                          schedule_stages: null, schedule_next_due_at: null
                                        }).eq('onboarding_id', selectedRecord.id)
                                        if (error) { showError('Failed to reset schedule'); return }
                                        await loadM365Actions(selectedRecord.id)
                                        showSuccess('Schedule reset — ready to create a new one')
                                      }}>
                                      Create New Schedule
                                    </button>
                                  )}
                                </div>
                                {m365Actions.schedule_status === 'completed' && m365Actions.run_result && (
                                  <div style={{ marginTop: 8, background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10 }}>
                                    <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Account provisioned successfully</p>
                                    {m365Actions.m365_upn && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>Email: {m365Actions.m365_upn}</p>}
                                  </div>
                                )}
                                {/* TAP card */}
                                {m365Actions.pass_status && (
                                  <div style={{ marginTop: 10, border: '1px solid #bbdefb', borderRadius: 8, padding: 12, background: 'rgba(227,242,253,.3)' }}>
                                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1565c0', display: 'flex', alignItems: 'center', gap: 6 }}>
                                      🔑 First-Day Sign-In Pass
                                    </p>
                                    {m365Actions.pass_status === 'pending' && (
                                      <p style={{ margin: '6px 0 0', fontSize: 12, color: '#888' }}>Pass will be ready on the start date</p>
                                    )}
                                    {m365Actions.pass_status === 'ready' && (
                                      <div style={{ marginTop: 6 }}>
                                        <p style={{ margin: 0, fontSize: 12, color: '#2e7d32' }}>Pass is ready</p>
                                        {m365Actions.pass_expires_at && (
                                          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#888' }}>
                                            Expires: {new Date(m365Actions.pass_expires_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                          </p>
                                        )}
                                        <p style={{ margin: '6px 0 4px', fontSize: 11, color: '#c62828', fontWeight: 500 }}>This pass is shown once and then deleted</p>
                                        <button className="admin-btn-sm admin-btn-save" disabled={tapRevealing}
                                          onClick={() => setTapRevealConfirmOpen(true)}
                                          style={{ background: '#0078D4', marginTop: 4 }}>
                                          {tapRevealing ? 'Revealing...' : 'View Pass (Once)'}
                                        </button>
                                      </div>
                                    )}
                                    {m365Actions.pass_status === 'viewed' && (
                                      <div style={{ marginTop: 6 }}>
                                        <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
                                          Pass viewed{m365Actions.pass_viewed_at ? ` on ${new Date(m365Actions.pass_viewed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
                                        </p>
                                        <span style={{ display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 4, background: '#e0e0e0', fontSize: 11, fontWeight: 600, color: '#666' }}>Viewed</span>
                                      </div>
                                    )}
                                    {(m365Actions.pass_status === 'expired' || m365Actions.pass_status === 'gone') && (
                                      <div style={{ marginTop: 6 }}>
                                        <p style={{ margin: 0, fontSize: 12, color: '#888' }}>This pass is no longer available</p>
                                        <button className="admin-btn-sm" disabled={tapRequesting}
                                          onClick={() => tapRequestNewPass(selectedRecord.id)}
                                          style={{ marginTop: 6 }}>
                                          {tapRequesting ? (tapJobPolling ? 'Creating pass...' : 'Requesting...') : 'Request a New Pass'}
                                        </button>
                                      </div>
                                    )}
                                    {m365Actions.pass_status === 'error' && (
                                      <div style={{ marginTop: 6 }}>
                                        <p style={{ margin: 0, fontSize: 12, color: '#c62828' }}>Pass could not be issued — check InflowOnboarder settings</p>
                                        <button className="admin-btn-sm" disabled={tapRequesting}
                                          onClick={() => tapRequestNewPass(selectedRecord.id)}
                                          style={{ marginTop: 6 }}>
                                          {tapRequesting ? 'Requesting...' : 'Request a New Pass'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {m365Actions.pass_status === 'blocked' && (
                                  <div style={{ marginTop: 10, border: '1px solid #ef9a9a', borderRadius: 8, padding: 12, background: 'rgba(255,235,238,.5)' }}>
                                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#c62828', display: 'flex', alignItems: 'center', gap: 6 }}>
                                      ⚠ Sign-In Blocked
                                    </p>
                                    <p style={{ margin: '6px 0 0', fontSize: 12, color: '#b71c1c' }}>
                                      {selectedRecord?.firstname} {selectedRecord?.surname} can't sign in yet: {(m365Actions as any).pass_error_detail?.message || 'a pass issue is blocking the schedule'}. An InflowOnboarder admin needs to fix this, or change the schedule to drop the pass.
                                    </p>
                                  </div>
                                )}
                                {m365Actions.pass_status === 'skipped' && m365Actions.run_status !== 'failed' && (
                                  <div style={{ marginTop: 10, border: '1px solid #ffcc80', borderRadius: 8, padding: 12, background: 'rgba(255,243,224,.4)' }}>
                                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e65100', display: 'flex', alignItems: 'center', gap: 6 }}>
                                      ⚠ No First-Day Pass
                                    </p>
                                    <p style={{ margin: '6px 0 0', fontSize: 12, color: '#bf360c' }}>
                                      {selectedRecord?.firstname} {selectedRecord?.surname}'s account is being set up without a first-day pass. They'll need another way to sign in on their first day.
                                    </p>
                                    {m365Actions.m365_user_id && ifoSettings?.passes_ready && ifoSettings?.passes_available !== false && (
                                      <button className="admin-btn-sm" disabled={tapRequesting}
                                        onClick={() => tapRequestNewPass(selectedRecord!.id)}
                                        style={{ marginTop: 8, background: '#e65100', color: '#fff', border: 'none' }}>
                                        {tapRequesting ? (tapJobPolling ? 'Creating pass...' : 'Requesting...') : 'Request a New Pass'}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Schedule pending approval */}
                            {!m365Actions?.is_v1_legacy && m365Actions?.schedule_status === 'pending_approval' && !m365Actions.schedule_id && (
                              <div style={{ marginBottom: 12 }}>
                                {m365Actions.approval_status === 'pending' && (
                                  <div style={{ background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10 }}>
                                    <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Schedule awaiting approval</p>
                                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                      Sent {m365Actions.approval_sent_at ? `on ${new Date(m365Actions.approval_sent_at).toLocaleString('en-GB')}` : ''}
                                    </p>
                                  </div>
                                )}
                                {m365Actions.approval_status === 'approved' && (
                                  <div>
                                    <div style={{ background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                      <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Schedule approved — ready to create</p>
                                    </div>
                                    {ifoSettings?.passes_ready && ifoSettings?.passes_available !== false ? (
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13, cursor: 'pointer' }}>
                                        <input type="checkbox" checked={m365IssuePass} onChange={e => setM365IssuePass(e.target.checked)} />
                                        Give {selectedRecord.firstname} a first-day sign-in pass (collected once by {selectedRecord.manager || 'their manager'})
                                      </label>
                                    ) : ifoSettings?.passes_status_detail?.includes('Suspended') ? (
                                      <p style={{ fontSize: 12, color: '#e65100', margin: '0 0 10px' }}>
                                        First-day passes temporarily suspended{ifoSettings.passes_status_detail.includes(': ') ? ` — ${ifoSettings.passes_status_detail.split(': ').slice(1).join(': ')}` : ''}
                                      </p>
                                    ) : null}
                                    <button className="admin-btn-sm admin-btn-save" disabled={m365ScheduleCreating}
                                      onClick={e => { e.stopPropagation(); m365CreateSchedule(selectedRecord) }}
                                      style={{ background: '#0078D4' }}>
                                      {m365ScheduleCreating ? 'Creating...' : 'Create Schedule'}
                                    </button>
                                  </div>
                                )}
                                {m365Actions.approval_status === 'declined' && (
                                  <div>
                                    <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                      <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Schedule approval declined</p>
                                    </div>
                                    <button className="admin-btn-sm admin-btn-save" disabled={m365ApprovalSending}
                                      onClick={e => { e.stopPropagation(); m365SendScheduleApproval(selectedRecord) }}
                                      style={{ background: '#0078D4' }}>
                                      Re-send for Approval
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Licence assignment skipped notice */}
                            {skipLicence && !m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && (m365Actions?.run_status === 'checking_licence' || m365Actions?.run_status === 'licence_unavailable') && (
                              <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, fontSize: 13, color: '#6d4c00' }}>
                                Licence assignment skipped per company settings.
                              </div>
                            )}
                            {/* Checking licence (or unknown status with a run_id) — hide if schedule path active */}
                            {!skipLicence && !m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && (m365Actions?.run_status === 'checking_licence' || (m365Actions?.run_id && !m365Actions?.run_status)) && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                  <span style={{ fontSize: 13, color: '#1976d2' }}>Checking licence availability...</span>
                                </div>
                                <button className="admin-btn-sm" disabled={m365RunPolling} style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                                  onClick={e => { e.stopPropagation(); m365RefreshStatus(m365Actions!.run_id!, selectedRecord.id) }}>
                                  {m365RunPolling ? <><div style={{ width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> Checking...</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh Status</>}
                                </button>
                              </div>
                            )}

                            {/* Licence unavailable — hide if schedule path active */}
                            {!skipLicence && !m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && m365Actions?.run_status === 'licence_unavailable' && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>No licence seats available</p>
                                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                    {m365Actions.run_error?.message || 'Purchase more seats then click Re-check.'}
                                    {ifoSettings?.licence_manager_name && (
                                      <> Contact {ifoSettings.licence_manager_name} to add seats.</>
                                    )}
                                  </p>
                                </div>
                                <button className="admin-btn-sm" disabled={m365RunPolling}
                                  onClick={e => { e.stopPropagation(); m365RecheckRun(m365Actions!.run_id!, selectedRecord.id) }}
                                  style={{ alignSelf: 'flex-start' }}>
                                  {m365RunPolling ? 'Re-checking...' : 'Done — Re-check'}
                                </button>
                              </div>
                            )}

                            {/* Ready for approval — not yet sent — hide if schedule path active */}
                            {!m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && m365Actions?.run_status === 'ready_for_approval' && !m365Actions.approval_status && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(232,242,255,.5)', border: '1px solid #90caf9', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#1565c0', fontWeight: 600 }}>Licence available — ready for approval</p>
                                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#1976d2' }}>
                                    Approver: {ifoSettings?.approver_mode === 'manager'
                                      ? ((selectedRecord as any).manager || 'Joiner\'s manager')
                                      : (ifoSettings?.approver_name || ifoSettings?.approver_email || 'Nominated person')}
                                  </p>
                                </div>
                                <button className="admin-btn-sm admin-btn-save" disabled={m365ApprovalSending}
                                  onClick={e => { e.stopPropagation(); m365SendApproval(selectedRecord) }}
                                  style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                  {m365ApprovalSending ? 'Sending...' : 'Send for Approval'}
                                </button>
                              </div>
                            )}

                            {/* Approval pending — hide if schedule path active */}
                            {!m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && m365Actions?.approval_status === 'pending' && (
                              <div style={{ marginBottom: 12, background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10 }}>
                                <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Waiting for approval</p>
                                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                  Sent to {ifoSettings?.approver_mode === 'manager'
                                    ? ((selectedRecord as any).manager_email || 'manager')
                                    : (ifoSettings?.approver_email || 'approver')}
                                  {m365Actions.approval_sent_at && <> on {new Date(m365Actions.approval_sent_at).toLocaleString('en-GB')}</>}
                                </p>
                              </div>
                            )}

                            {/* Approval approved — proceed — hide if schedule path active */}
                            {!m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && m365Actions?.approval_status === 'approved' && m365Actions?.run_status === 'ready_for_approval' && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Approved by {(m365Actions.approved_by || '').replace(/<[^>]+>/, '').trim() || m365Actions.approved_by}</p>
                                  {m365Actions.approved_at && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>{new Date(m365Actions.approved_at).toLocaleString('en-GB')}</p>}
                                </div>
                                <button className="admin-btn-sm admin-btn-save" disabled={m365Proceeding}
                                  onClick={e => { e.stopPropagation(); m365ProceedRun(selectedRecord) }}
                                  style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                  {m365Proceeding ? 'Proceeding...' : 'Proceed — Create Account'}
                                </button>
                              </div>
                            )}

                            {/* Approval declined — hide if schedule path active */}
                            {!m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && m365Actions?.approval_status === 'declined' && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Approval declined</p>
                                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                                    Declined by {(m365Actions.approved_by || '').replace(/<[^>]+>/, '').trim() || m365Actions.approved_by}
                                    {m365Actions.approved_at && <> on {new Date(m365Actions.approved_at).toLocaleString('en-GB')}</>}
                                  </p>
                                </div>
                                <button className="admin-btn-sm admin-btn-save" disabled={m365ApprovalSending}
                                  onClick={e => { e.stopPropagation(); m365SendApproval(selectedRecord) }}
                                  style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                  Re-send for Approval
                                </button>
                              </div>
                            )}

                            {/* Provisioning in progress — hide if schedule path active */}
                            {!m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && m365Actions?.run_status === 'provisioning' && (
                              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13, color: '#1976d2' }}>Provisioning in progress — creating account, assigning licence and adding to group...</span>
                              </div>
                            )}

                            {/* Awaiting approval (engine-side) — hide if schedule path active */}
                            {!m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && m365Actions?.run_status === 'awaiting_approval' && (
                              <div style={{ marginBottom: 12, background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10 }}>
                                <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Awaiting approval in InflowOnboarder</p>
                                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                  The engine is waiting for approval. This will update automatically.
                                </p>
                              </div>
                            )}

                            {/* Completed (ad-hoc) — hide if schedule path active */}
                            {!m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && m365Actions?.run_status === 'completed' && (
                              <div style={{ background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10, marginBottom: 12 }}>
                                <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>M365 provisioning complete</p>
                                {m365Actions.m365_upn && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>UPN: {m365Actions.m365_upn}</p>}
                                {m365Actions.m365_user_id && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#4caf50' }}>User ID: {m365Actions.m365_user_id}</p>}
                                {m365Actions.run_result?.temporaryPassword && (
                                  <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(255,248,225,.7)', border: '1px solid #ffe0b2', borderRadius: 4 }}>
                                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#e65100' }}>Temporary Password</p>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 0' }}>
                                      <p style={{ margin: 0, fontSize: 13, fontFamily: 'monospace', color: '#bf360c' }}>{'•'.repeat(12)}</p>
                                      <button
                                        style={{ background: 'none', border: '1px solid #e65100', borderRadius: 3, padding: '1px 6px', fontSize: 11, color: '#e65100', cursor: 'pointer' }}
                                        onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(m365Actions.run_result.temporaryPassword) }}
                                      >Copy</button>
                                    </div>
                                    <p style={{ margin: '4px 0 0', fontSize: 11, color: '#e65100' }}>Share securely with the new starter — they must change it on first sign-in.</p>
                                  </div>
                                )}
                                {m365Actions.run_result?.manual && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#666' }}>Completed manually by {m365Actions.run_result.completedBy}</p>}
                              </div>
                            )}

                            {/* Failed (ad-hoc) — hide if schedule path active */}
                            {!m365Actions?.is_v1_legacy && !m365Actions?.schedule_id && !m365Actions?.schedule_status && m365Actions?.run_status === 'failed' && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                  <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Provisioning failed</p>
                                  {m365Actions.run_error && (
                                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                                      {m365Actions.run_error.code}: {m365Actions.run_error.message}
                                    </p>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button className="admin-btn-sm" disabled={m365RunPolling}
                                    onClick={e => { e.stopPropagation(); m365RecheckRun(m365Actions!.run_id!, selectedRecord.id) }}>
                                    Re-check
                                  </button>
                                  <button className="admin-btn-sm"
                                    onClick={e => { e.stopPropagation(); m365MarkCompleteManual(selectedRecord.id) }}>
                                    Mark Complete Manually
                                  </button>
                                </div>
                              </div>
                            )}
                    </div>
                  )}

                  {/* M365 provisioning info banner */}
                  {step.step_key === 'accounts' && features.inflowonboarder_integration && ifoConnected && m365Actions && identityProvider !== 'google_workspace' && m365Actions.schedule_id && (
                    <div style={{ border: '1px solid #90caf9', borderRadius: 10, padding: '12px 14px', marginBottom: 20, background: 'linear-gradient(135deg, rgba(232,242,255,.6), rgba(227,242,253,.4))' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14 }}>⚡</span>
                        <strong style={{ fontSize: 12, color: '#1565c0' }}>M365 Schedule Active</strong>
                      </div>
                      {selectedRecord.start_date && (
                        <p style={{ fontSize: 12, color: '#37474f', margin: 0, lineHeight: 1.5 }}>
                          Account creation scheduled for {(() => { const d = new Date(selectedRecord.start_date); d.setDate(d.getDate() - 3); return d.toLocaleDateString('en-GB') })()} at 09:00. Sign-in enabled on {new Date(selectedRecord.start_date).toLocaleDateString('en-GB')} at 08:00.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Account Goes Live status */}
                  {(() => {
                    const isLastPrepStep = prepSteps[prepSteps.length - 1]?.step_key === step.step_key
                    return isLastPrepStep && postSteps.length > 0 ? (
                      <div style={{ margin: '0 0 20px', textAlign: 'center' }}>
                        <div style={{
                          display: 'inline-block', padding: '8px 16px', borderRadius: 8, fontWeight: 700, fontSize: 11,
                          background: allPrepDone ? 'linear-gradient(135deg, #d1fae5, #a7f3d0)' : '#f3f4f6',
                          color: allPrepDone ? '#065f46' : '#9ca3af',
                          border: `2px solid ${allPrepDone ? '#6ee7b7' : '#e5e7eb'}`,
                        }}>
                          {allPrepDone ? '✓ Account Live' : '🔒 Account Goes Live'}
                        </div>
                      </div>
                    ) : null
                  })()}

                  {/* Checklist */}
                  {checklistForStep.length > 0 && (
                    <div className="admin-wf-detail-section">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <h5 className="admin-wf-detail-section-title" style={{ margin: 0 }}>CHECKLIST</h5>
                        <span className="admin-wf-checklist-count">{checklistDone}/{checklistForStep.length}</span>
                      </div>
                      <ul className="admin-wf-checklist">
                        {checklistForStep.map(item => (
                          <li key={item.id} className={`admin-wf-checklist-item ${checklistCompleted[item.id] ? 'checked' : ''}`}
                            onClick={() => toggleChecklistItem(step.step_key, item.id)}>
                            <div className="admin-wf-checklist-check">
                              {checklistCompleted[item.id] && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                            </div>
                            <span className="admin-wf-checklist-label">{item.label}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Activity log */}
                  {stepLogs.length > 0 && (
                    <div className="admin-wf-detail-section">
                      <h5 className="admin-wf-detail-section-title">ACTIVITY</h5>
                      <ul className="admin-wf-activity">
                        {stepLogs.slice(0, 10).map(log => (
                          <li key={log.id} className="admin-wf-activity-item">
                            <span className="admin-wf-activity-date">{new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                            <span className="admin-wf-activity-text">{log.action}{log.actor_name ? ` — ${log.actor_name}` : ''}{log.detail ? ` (${log.detail})` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Previous / Next navigation */}
                <div className="admin-wf-nav">
                  <div>
                    {workflowStep > 0 && (
                      <button className="admin-wf-nav-btn" onClick={() => { setWorkflowStep(workflowStep - 1); if (activeSteps[workflowStep - 1]?.step_key === 'accounts' && selectedId && features.inflowonboarder_integration) loadM365Actions(selectedId) }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                        <div>
                          <div className="admin-wf-nav-label">Previous</div>
                          <div>{activeSteps[workflowStep - 1]?.label}</div>
                        </div>
                      </button>
                    )}
                  </div>
                  <div>
                    {workflowStep < activeSteps.length - 1 && (
                      <button className="admin-wf-nav-btn" onClick={() => { setWorkflowStep(workflowStep + 1); if (activeSteps[workflowStep + 1]?.step_key === 'accounts' && selectedId && features.inflowonboarder_integration) loadM365Actions(selectedId) }}
                        style={{ textAlign: 'right' }}>
                        <div>
                          <div className="admin-wf-nav-label">Next</div>
                          <div>{activeSteps[workflowStep + 1]?.label}</div>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              </>
            )
          })()}
          </div>
        </div>
      )}

      {(tab === 'offboarding' || (tab === 'jml' && jmlSection === 'leavers')) && (
        <div>
          {/* New Offboard */}
          <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--admin-border, #e0e0e0)', marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Start Offboarding</h3>
            <input
              className="admin-input"
              placeholder="Search employee by name or email..."
              value={offboardEmployeeSearch}
              onChange={e => searchEmployeesForOffboard(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            {offboardEmployeeResults.length > 0 && (
              <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
                {offboardEmployeeResults.map(emp => (
                  <div key={emp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                    <div>
                      <strong>{emp.first_name} {emp.last_name}</strong>
                      <span style={{ color: '#888', marginLeft: 8 }}>{emp.job_title} · {emp.department}</span>
                    </div>
                    <button className="admin-btn-sm admin-btn-save" onClick={() => {
                      setOffboardEmployeeSearch(`${emp.first_name} ${emp.last_name}`)
                      setOffboardEmployeeResults([])
                    }} style={{ display: 'none' }} />
                    <button className="admin-btn-sm" style={{ background: '#c62828', color: '#fff', border: 'none' }} onClick={() => createOffboardRecord(emp)}>
                      Start Offboarding
                    </button>
                  </div>
                ))}
              </div>
            )}
            {offboardEmployeeSearch.length >= 2 && offboardEmployeeResults.length > 0 && (
              <div className="admin-form-grid" style={{ marginTop: 0 }}>
                <div className="admin-form-field">
                  <label>Last Working Date</label>
                  <input type="date" className="admin-input" value={offboardForm.end_date} onChange={e => setOffboardForm(p => ({ ...p, end_date: e.target.value }))} />
                </div>
                <div className="admin-form-field">
                  <label>Reason</label>
                  <select className="admin-select" value={offboardForm.reason} onChange={e => setOffboardForm(p => ({ ...p, reason: e.target.value }))}>
                    <option value="">Select reason</option>
                    <option>Resignation</option>
                    <option>Redundancy</option>
                    <option>End of contract</option>
                    <option>Retirement</option>
                    <option>Dismissal</option>
                    <option>Mutual agreement</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Active Offboarding List */}
          {activeOffboardRecords.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Active Offboarding</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Employee</th><th>Role</th><th>End Date</th><th>Reason</th><th>Progress</th><th>Actions</th></tr></thead>
                  <tbody>
                    {paginatedActiveOffboard.map(r => {
                      const doneCount = OFFBOARD_STEPS.filter(s => r.workflow_steps?.[s.key] || r.skipped_steps?.[s.key]).length
                      return (
                        <tr key={r.id}>
                          <td><strong>{r.employee_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{r.employee_email}</span></td>
                          <td>{r.job_title || '—'}</td>
                          <td>{r.end_date ? new Date(r.end_date).toLocaleDateString('en-GB') : '—'}</td>
                          <td>{r.reason || '—'}</td>
                          <td>
                            <div className="admin-progress-bar"><div className="admin-progress-fill" style={{ width: `${(doneCount / OFFBOARD_STEPS.length) * 100}%`, background: '#c62828' }} /></div>
                            <span className="admin-progress-text">{doneCount}/{OFFBOARD_STEPS.length}</span>
                          </td>
                          <td className="admin-actions">
                            <button className="admin-btn-sm admin-btn-save" onClick={() => openOffboardWorkflow(r)}>Workflow</button>
                            <button className="admin-btn-sm" style={{ background: '#e0e0e0', color: '#333', border: 'none' }} onClick={() => cancelOffboarding(r)}>Cancel</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {offTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button className="admin-action-btn" disabled={offPage <= 1} onClick={() => setOffPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13 }}>Page {offPage} of {offTotalPages}</span>
                  <button className="admin-action-btn" disabled={offPage >= offTotalPages} onClick={() => setOffPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}

          {/* Frozen Employees */}
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Frozen Employees — Deletion Queue</h3>
            {frozenEmployees.length > 0 ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Employee</th><th>Frozen Date</th><th>Deletion Countdown</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {paginatedFrozen.map(f => {
                      const now = new Date()
                      const effectiveDelDate = new Date(f.deletion_date)
                      if (f.extension_days) effectiveDelDate.setDate(effectiveDelDate.getDate() + f.extension_days)
                      const daysLeft = Math.ceil((effectiveDelDate.getTime() - now.getTime()) / 86400000)
                      const totalDays = 30 + (f.extension_days || 0)
                      const elapsed = totalDays - Math.max(daysLeft, 0)
                      const pct = Math.min(100, Math.max(0, (elapsed / totalDays) * 100))
                      const barColor = daysLeft <= 7 ? '#c62828' : daysLeft <= 15 ? '#ff9800' : '#4caf50'
                      const statusLabel = f.status === 'recovered' ? 'Recovered' : daysLeft <= 0 ? 'Ready to Delete' : 'Awaiting Expiry'
                      const statusColor = f.status === 'recovered' ? '#43a047' : daysLeft <= 0 ? '#c62828' : '#ff9800'
                      return (
                        <tr key={f.id}>
                          <td><strong>{f.employee_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{f.employee_email}</span></td>
                          <td>{new Date(f.frozen_at).toLocaleDateString('en-GB')}</td>
                          <td>
                            {f.status !== 'recovered' ? (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                                  <span style={{ fontWeight: 600, color: daysLeft <= 7 ? '#c62828' : '#333' }}>{daysLeft > 0 ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining` : 'Expired'}</span>
                                  <span style={{ color: '#888' }}>{effectiveDelDate.toLocaleDateString('en-GB')}</span>
                                </div>
                                <div style={{ background: '#e0e0e0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                                  <div style={{ background: barColor, height: '100%', width: `${pct}%`, borderRadius: 4, transition: 'width 0.3s' }} />
                                </div>
                                {f.extended_at && <span style={{ fontSize: 11, color: '#2196f3', marginTop: 2, display: 'block' }}>+15 day extension applied</span>}
                              </div>
                            ) : <span style={{ color: '#888' }}>—</span>}
                          </td>
                          <td><span className="admin-badge" style={{ background: statusColor, color: '#fff' }}>{statusLabel}</span></td>
                          <td className="admin-actions">
                            {f.status !== 'recovered' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button className="admin-btn-sm" style={{ background: '#43a047', color: '#fff', border: 'none' }} onClick={() => recoverEmployee(f)}>Recover</button>
                                  <button className="admin-btn-sm" style={{ background: '#c62828', color: '#fff', border: 'none' }} onClick={() => deleteEmployee(f)}>Delete Now</button>
                                </div>
                                {!f.extended_at && daysLeft > 0 && (
                                  <button className="admin-btn-sm" style={{ background: '#2196f3', color: '#fff', border: 'none', fontSize: 11 }} onClick={() => extendFrozenPeriod(f)}>
                                    Extend +15 Days
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-empty">No frozen employees</div>
            )}
            {frozenTotalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button className="admin-action-btn" disabled={frozenPage <= 1} onClick={() => setFrozenPage(p => p - 1)}>Prev</button>
                <span style={{ fontSize: 13 }}>Page {frozenPage} of {frozenTotalPages}</span>
                <button className="admin-action-btn" disabled={frozenPage >= frozenTotalPages} onClick={() => setFrozenPage(p => p + 1)}>Next</button>
              </div>
            )}
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#888', fontStyle: 'italic' }}>
              After the retention period expires, ALL employee data is permanently deleted and a deletion certificate is produced for GDPR compliance.
            </p>
          </div>

          {/* Deletion Certificates */}
          {deletionCertificates.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Deletion Certificates</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Employee</th><th>Certificate Ref</th><th>Deleted</th><th>Retention</th><th>Data Categories</th></tr></thead>
                  <tbody>
                    {deletionCertificates.map(cert => (
                      <tr key={cert.id}>
                        <td><strong>{cert.employee_name}</strong><br /><span style={{ fontSize: 12, color: '#888' }}>{cert.employee_email}</span></td>
                        <td><code style={{ fontSize: 12, background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>{cert.certificate_reference}</code></td>
                        <td>{new Date(cert.deleted_at).toLocaleDateString('en-GB')}</td>
                        <td>{cert.retention_days} days{cert.data_export_provided && <span style={{ fontSize: 11, color: '#4caf50', marginLeft: 4 }}>(export provided)</span>}</td>
                        <td style={{ fontSize: 12 }}>
                          {cert.data_categories_held.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {cert.data_categories_held.map((cat, i) => (
                                <span key={i} style={{ background: '#e3f2fd', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{cat.replace(/_/g, ' ')}</span>
                              ))}
                            </div>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Completed Offboarding */}
          {completedOffboardRecords.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px', color: '#888' }}>Completed Offboarding</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th style={{ width: 30 }}></th><th>Employee</th><th>Role</th><th>End Date</th><th>Reason</th><th>Frozen</th></tr></thead>
                  <tbody>
                    {paginatedCompletedOffboard.map(r => {
                      const isExpanded = expandedCompletedId === r.id
                      const steps = offboardCustomSteps.length > 0 ? offboardCustomSteps : OFFBOARD_STEPS
                      return (<span key={r.id} style={{ display: 'contents' }}>
                        <tr style={{ opacity: 0.7, cursor: 'pointer' }} onClick={() => setExpandedCompletedId(isExpanded ? null : r.id)}>
                          <td style={{ textAlign: 'center', fontSize: 14 }}>{isExpanded ? '▼' : '▶'}</td>
                          <td><strong>{r.employee_name}</strong></td>
                          <td>{r.job_title || '—'}</td>
                          <td>{r.end_date ? new Date(r.end_date).toLocaleDateString('en-GB') : '—'}</td>
                          <td>{r.reason || '—'}</td>
                          <td>{r.frozen_at ? new Date(r.frozen_at).toLocaleDateString('en-GB') : '—'}</td>
                        </tr>
                        {isExpanded && (
                          <tr><td colSpan={6} style={{ padding: 0, background: 'var(--bg-muted, #fafafa)' }}>
                            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                              <div>
                                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted, #666)' }}>Workflow Steps</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {steps.map((s: any) => {
                                    const key = s.step_key || s.key
                                    const completed = r.workflow_steps?.[key]
                                    const skipped = r.skipped_steps?.[key]
                                    const customDone = r.custom_steps_completed?.[key]
                                    const status = completed || customDone ? 'done' : skipped ? 'skipped' : 'not_reached'
                                    return (
                                      <span key={key} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
                                        background: status === 'done' ? '#e8f5e9' : status === 'skipped' ? '#fff8e1' : '#f5f5f5',
                                        color: status === 'done' ? '#2e7d32' : status === 'skipped' ? '#f57f17' : '#999',
                                        border: `1px solid ${status === 'done' ? '#a5d6a7' : status === 'skipped' ? '#ffe082' : '#e0e0e0'}`,
                                      }}>
                                        <span>{status === 'done' ? '✓' : status === 'skipped' ? '⏭' : '○'}</span>
                                        {s.label}
                                      </span>
                                    )
                                  })}
                                </div>
                              </div>
                              <div>
                                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted, #666)' }}>Cleanup Actions</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {[
                                    { label: 'Shifts cancelled', done: r.cleanup_shifts_done },
                                    { label: 'Bookings cancelled', done: r.cleanup_bookings_done },
                                    { label: 'Benefits unenrolled', done: r.cleanup_benefits_done },
                                    { label: 'Assets reviewed', done: r.cleanup_assets_done },
                                  ].map(c => (
                                    <span key={c.label} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
                                      background: c.done ? '#e8f5e9' : '#f5f5f5', color: c.done ? '#2e7d32' : '#999',
                                      border: `1px solid ${c.done ? '#a5d6a7' : '#e0e0e0'}`,
                                    }}>
                                      <span>{c.done ? '✓' : '○'}</span>{c.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: 'var(--text-muted, #666)' }}>
                                <span><strong>Started:</strong> {new Date(r.created_at).toLocaleDateString('en-GB')}</span>
                                {r.end_date && <span><strong>Leave date:</strong> {new Date(r.end_date).toLocaleDateString('en-GB')}</span>}
                                {r.frozen_at && <span><strong>Account frozen:</strong> {new Date(r.frozen_at).toLocaleDateString('en-GB')}</span>}
                                {r.data_exported_at && <span><strong>GDPR export:</strong> {new Date(r.data_exported_at).toLocaleDateString('en-GB')}</span>}
                                {!r.data_exported_at && <span style={{ color: '#e65100' }}><strong>GDPR export:</strong> Not done</span>}
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </span>)
                    })}
                  </tbody>
                </table>
              </div>
              {complTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button className="admin-action-btn" disabled={complPage <= 1} onClick={() => setComplPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13 }}>Page {complPage} of {complTotalPages}</span>
                  <button className="admin-action-btn" disabled={complPage >= complTotalPages} onClick={() => setComplPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'offboard-workflow' && (() => {
        const record = offboardRecords.find(r => r.id === offboardSelectedId)
        if (!record) return <div className="admin-empty">Select an offboarding record</div>
        return (
          <div className="admin-workflow">
            <div className="admin-workflow-header">
              <h3>{record.employee_name}</h3>
              <p>{record.job_title} · Last day {record.end_date ? new Date(record.end_date).toLocaleDateString('en-GB') : 'TBC'}</p>
            </div>
            {features.inflowonboarder_integration && ifoConnected && leaverM365Actions && identityProvider !== 'google_workspace' && (
              <div style={{ border: '1px solid #ef9a9a', borderRadius: 10, padding: '14px 16px', margin: '0 0 16px', background: 'linear-gradient(135deg, rgba(255,235,238,.6), rgba(252,228,236,.4))' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 16 }}>⚡</span>
                  <strong style={{ fontSize: 13, color: '#c62828' }}>M365 Account Offboarding {leaverM365Actions.schedule_id ? 'Scheduled' : 'Active'}</strong>
                </div>
                {record.end_date ? (
                  <div style={{ fontSize: 12, color: '#37474f', lineHeight: 1.6 }}>
                    <p style={{ margin: '0 0 8px' }}>
                      {leaverM365Actions.schedule_id
                        ? <>Sign-in block is <strong>scheduled</strong> for <strong>{new Date(record.end_date).toLocaleDateString('en-GB')}</strong> at 17:00. Licences and groups will be removed {leaverLicenceRemovalDays} day{leaverLicenceRemovalDays !== 1 ? 's' : ''} later.</>
                        : <>Sign-in will be blocked on <strong>{new Date(record.end_date).toLocaleDateString('en-GB')}</strong> when triggered. Licences and groups removed {leaverLicenceRemovalDays} day{leaverLicenceRemovalDays !== 1 ? 's' : ''} after.</>
                      }
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <span style={{ color: '#4caf50', fontWeight: 700, flexShrink: 0 }}>Before</span>
                        <span>Complete equipment recovery, leaving meeting, shift/booking/benefit reviews, reassign direct reports and data export</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <span style={{ color: '#e65100', fontWeight: 700, flexShrink: 0 }}>On leave date</span>
                        <span>M365 sign-in blocked automatically at 17:00 — employee loses email and app access</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <span style={{ color: '#c62828', fontWeight: 700, flexShrink: 0 }}>After</span>
                        <span>Convert to shared mailbox, set up email forwarding, confirm final payments and issue P45</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: '#37474f', margin: 0, lineHeight: 1.5 }}>
                    M365 offboarding is connected. Set a leave date to see the automated timeline, then align manual tasks around it.
                  </p>
                )}
              </div>
            )}
            <div className="admin-workflow-timeline">
              {OFFBOARD_STEPS.map((step, i) => {
                const done = offboardChecks[step.key]
                const skipped = offboardSkips[step.key]
                const isCurrent = i === offboardStep
                return (
                  <div key={step.key} className={`admin-wf-step ${done ? 'admin-wf-done' : ''} ${skipped ? 'admin-wf-skipped' : ''} ${isCurrent ? 'admin-wf-current' : ''}`} onClick={() => { setOffboardStep(i); if (step.key === 'reassign_reports' && !done && !skipped && record) loadReassignData(record); if (step.key === 'remove_accounts') loadLeaverM365Actions(record.id) }}>
                    <div className="admin-wf-connector" />
                    <div className="admin-wf-dot">{done ? '✓' : skipped ? '⏭' : step.icon}</div>
                    <div className="admin-wf-content">
                      <h4>{step.label}{skipped && <span className="admin-wf-skip-badge">Skipped</span>}<span style={{ fontSize: 11, color: '#888', fontWeight: 400, marginLeft: 8 }}>{step.role}</span></h4>
                      {isCurrent && (
                        <div className="admin-wf-detail">
                          <p>{step.description}</p>

                          {/* ── Offboard Send Notification / Meeting button ── */}
                          {(() => {
                            const offCfg = (offboardCustomSteps.find(cs => cs.step_key === step.key)?.step_config) as StepConfig | undefined
                            if (!offCfg || (!offCfg.notify_email && !offCfg.notify_contact_key && !offCfg.notify_starter)) return null
                            const offReqDone = offCfg.requires_step ? offboardChecks[offCfg.requires_step] : true
                            return (
                              <div style={{ margin: '8px 0', padding: 10, border: '1px solid #c7d2fe', borderRadius: 8, background: '#eef2ff' }} onClick={e => e.stopPropagation()}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 12, color: '#4338ca', fontWeight: 600 }}>
                                    {STEP_TYPE_META[offCfg.step_type || 'checklist']?.icon || '📋'} {STEP_TYPE_META[offCfg.step_type || 'checklist']?.label || 'Task'}: {offCfg.notify_starter ? record.employee_name : offCfg.notify_contact_key ? (companyContacts.find(c => c.contact_key === offCfg.notify_contact_key)?.label || offCfg.notify_contact_key) : offCfg.notify_email}
                                  </span>
                                  {offCfg.requires_step && !offReqDone && <span style={{ fontSize: 11, color: '#dc2626' }}>Requires: {OFFBOARD_STEPS.find(s => s.key === offCfg.requires_step)?.label || offCfg.requires_step}</span>}
                                  <button
                                    className="admin-btn-sm admin-btn-save"
                                    disabled={stepNotifSending === step.key || !offReqDone}
                                    onClick={async () => {
                                      setStepNotifSending(step.key)
                                      await sendStepNotification(offCfg, record, step.label, 'offboarding')
                                      setStepNotifSending(null)
                                    }}
                                    style={{ fontSize: 12, padding: '4px 12px' }}
                                  >
                                    {stepNotifSending === step.key ? 'Sending...' : offCfg.meeting ? '📅 Send Meeting Invite' : '📧 Send Notification'}
                                  </button>
                                </div>
                                {offCfg.meeting && (
                                  <div style={{ marginTop: 6, fontSize: 11, color: '#6366f1' }}>
                                    Meeting: {resolveStepPlaceholders(offCfg.meeting.title || '', record)} · Attendees: {offCfg.meeting.attendees?.join(', ') || 'manager, leaver'}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* Survey assignment card (offboarding) */}
                          {(() => {
                            const offSurveyCfg = (offboardCustomSteps.find(cs => cs.step_key === step.key)?.step_config) as StepConfig | undefined
                            if (!offSurveyCfg || offSurveyCfg.step_type !== 'survey' || !offSurveyCfg.survey_id || done || skipped) return null
                            return (
                              <div style={{ margin: '8px 0', padding: 12, border: '1px solid #99f6e4', borderRadius: 8, background: '#f0fdfa' }} onClick={e => e.stopPropagation()}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 12, color: '#0d9488', fontWeight: 600 }}>📊 Survey: {companySurveys.find(s => s.id === offSurveyCfg.survey_id)?.title || 'Unknown'}</span>
                                  <button
                                    className="admin-btn-sm admin-btn-save"
                                    disabled={surveyAssigning === step.key}
                                    onClick={async () => {
                                      const ok = await assignSurveyToEmployee(offSurveyCfg.survey_id!, record.employee_email, record.employee_name, step.key)
                                      if (ok) completeOffboardStep(step.key)
                                    }}
                                    style={{ fontSize: 12, padding: '4px 12px', background: '#0d9488' }}
                                  >
                                    {surveyAssigning === step.key ? 'Assigning...' : `📊 Assign to ${record.employee_name.split(' ')[0]}`}
                                  </button>
                                </div>
                                <div style={{ fontSize: 11, color: '#115e59', marginTop: 4 }}>Assigns this survey to the employee and creates a pending response in their My Surveys page.</div>
                              </div>
                            )
                          })()}

                          {/* Timing hint for post-leave-date steps when M365 automation is active */}
                          {ifoConnected && leaverM365Actions && record.end_date && !done && !skipped && (() => {
                            const hints: Record<string, string> = {
                              remove_accounts: leaverM365Actions.schedule_id
                                ? `Scheduled: sign-in blocked on ${new Date(record.end_date).toLocaleDateString('en-GB')} at 17:00, licences removed ${leaverLicenceRemovalDays} days later. If you need to act sooner (e.g. garden leave), cancel the schedule and run manually.`
                                : `Best practice: complete on or after the leave date (${new Date(record.end_date).toLocaleDateString('en-GB')}). Removing access while the employee is still working may breach their contract unless they are on garden leave.`,
                              convert_shared_mailbox: `Best practice: convert after sign-in is blocked (${new Date(record.end_date).toLocaleDateString('en-GB')} at 17:00). The mailbox must remain active until the employee leaves.`,
                              forward_to_manager: `Best practice: set up forwarding after the leave date (${new Date(record.end_date).toLocaleDateString('en-GB')}). The employee should not see forwarded copies of their own mail.`,
                              confirm_payments: `Best practice: confirm after processing the final pay run covering all accrued holiday, expenses and deductions up to ${new Date(record.end_date).toLocaleDateString('en-GB')}. The P45 must be issued after, not before, the final pay.`,
                            }
                            const hint = hints[step.key]
                            if (!hint) return null
                            return (
                              <div style={{ margin: '8px 0', padding: '8px 12px', background: '#fffde7', border: '1px solid #fff9c4', borderRadius: 6, fontSize: 11, color: '#5d4037', lineHeight: 1.5, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f57f17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                <span>{hint}</span>
                              </div>
                            )
                          })()}

                          {/* Google Workspace note for remove_accounts */}
                          {step.key === 'remove_accounts' && identityProvider === 'google_workspace' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10, border: '1px solid #e0e0e0' }}>
                              <p style={{ margin: 0, fontSize: 13, color: '#666' }}>M365 provisioning is not available for Google Workspace companies. Create accounts manually.</p>
                            </div>
                          )}
                          {/* M365 Offboarding panel (InflowOnboarder leaver) */}
                          {step.key === 'remove_accounts' && features.inflowonboarder_integration && ifoConnected && !done && !skipped && identityProvider !== 'google_workspace' && (
                            <div style={{ margin: '12px 0', padding: 14, background: 'rgba(0,120,212,.06)', borderRadius: 10, border: '1px solid rgba(0,120,212,.15)' }} onClick={e => e.stopPropagation()}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0078D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                                </svg>
                                <strong style={{ fontSize: 13, color: '#0078D4' }}>Microsoft 365 Offboarding</strong>
                                {leaverM365RunPolling && <span style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>Updating...</span>}
                              </div>

                              {/* Function gating — leavers blocked */}
                              {(() => { const g = getFunctionGating('leavers'); return g.blocked && !leaverM365Actions?.run_id && !leaverM365Actions?.schedule_id ? (
                                <div style={{ marginBottom: 12, padding: 12, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffe0b2' }}>
                                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e65100' }}>Leaver provisioning: {g.message}</p>
                                  {g.reason && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>{g.reason}</p>}
                                </div>
                              ) : null })()}
                              {/* No run yet — start or schedule */}
                              {!leaverM365Actions?.run_id && !leaverM365Actions?.schedule_id && !leaverM365Actions?.schedule_status && !getFunctionGating('leavers').blocked && (
                                <div>
                                  {leaverSchedulingAvailable && (
                                    <div style={{ display: 'flex', gap: 0, marginBottom: 10, borderRadius: 6, overflow: 'hidden', border: '1px solid #90caf9', width: 'fit-content' }}>
                                      <button onClick={e => { e.stopPropagation(); setLeaverScheduleMode('now') }}
                                        style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                          background: leaverScheduleMode === 'now' ? '#0078D4' : '#fff', color: leaverScheduleMode === 'now' ? '#fff' : '#0078D4' }}>
                                        Run Now
                                      </button>
                                      <button onClick={e => { e.stopPropagation(); setLeaverScheduleMode('schedule') }}
                                        style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                                          background: leaverScheduleMode === 'schedule' ? '#0078D4' : '#fff', color: leaverScheduleMode === 'schedule' ? '#fff' : '#0078D4' }}>
                                        Schedule
                                      </button>
                                    </div>
                                  )}
                                  {(!leaverSchedulingAvailable || leaverScheduleMode === 'now') && (
                                    <div>
                                      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted, #666)' }}>
                                        Block sign-in, remove from groups, and revoke licences for <strong>{record.employee_email}</strong>
                                      </p>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverM365Starting}
                                        onClick={e => { e.stopPropagation(); leaverM365StartRun(record) }}>
                                        {leaverM365Starting ? 'Starting...' : 'Start M365 Offboarding'}
                                      </button>
                                    </div>
                                  )}
                                  {leaverSchedulingAvailable && leaverScheduleMode === 'schedule' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      <div style={{ width: 180 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2, color: record.end_date ? undefined : '#c62828' }}>Leave date{!record.end_date ? ' (required)' : ''}</label>
                                        <input className="admin-input" type="date"
                                          value={record.end_date ? record.end_date.split('T')[0] : ''}
                                          onChange={async e => {
                                            const v = e.target.value
                                            if (!v) return
                                            const { error } = await supabase.from('offboarding').update({ end_date: v }).eq('id', record.id)
                                            if (error) { showError('Failed to save leave date'); return }
                                            setOffboardRecords(prev => prev.map(r => r.id === record.id ? { ...r, end_date: v } : r))
                                          }}
                                          style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                      <div style={{ width: 180 }}>
                                        <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Remove licence & groups on</label>
                                        <input className="admin-input" type="date"
                                          value={leaverRemovalDate || (() => { if (!record.end_date) return ''; const d = new Date(new Date(record.end_date + 'T00:00:00').getTime() + leaverLicenceRemovalDays * 86400000); return d.toISOString().split('T')[0] })()}
                                          min={record.end_date ? record.end_date.split('T')[0] : ''}
                                          onChange={e => { const v = e.target.value; setLeaverRemovalDate(v); if (v && record.end_date) { const diff = Math.round((new Date(v + 'T00:00:00').getTime() - new Date(record.end_date.split('T')[0] + 'T00:00:00').getTime()) / 86400000); setLeaverLicenceRemovalDays(Math.max(0, diff)) } }}
                                          style={{ fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                                      </div>
                                      <div style={{ background: 'rgba(232,242,255,.5)', border: '1px solid #bbdefb', borderRadius: 6, padding: 10 }}>
                                        <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#1565c0' }}>Schedule plan</p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                            <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#e3f2fd', border: '1px solid #90caf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#1565c0', flexShrink: 0 }}>1</span>
                                            <span>Block access — <strong>{record.end_date ? new Date(record.end_date).toLocaleDateString('en-GB') : 'leave date'}</strong> at 17:00</span>
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                            <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#e3f2fd', border: '1px solid #90caf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#1565c0', flexShrink: 0 }}>2</span>
                                            <span>Remove groups & licence — <strong>{leaverRemovalDate ? new Date(leaverRemovalDate + 'T00:00:00').toLocaleDateString('en-GB') : record.end_date ? new Date(new Date(record.end_date + 'T00:00:00').getTime() + leaverLicenceRemovalDays * 86400000).toLocaleDateString('en-GB') : `${leaverLicenceRemovalDays} days after`}</strong> at 17:00</span>
                                          </div>
                                        </div>
                                      </div>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverM365ApprovalSending}
                                        onClick={e => { e.stopPropagation(); leaverSendScheduleApproval(record) }}
                                        style={{ background: '#0078D4', alignSelf: 'flex-start' }}>
                                        {leaverM365ApprovalSending ? 'Sending...' : 'Send Schedule for Approval'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Schedule pending approval */}
                              {leaverM365Actions?.schedule_status === 'pending_approval' && !leaverM365Actions.schedule_id && (
                                <div style={{ marginBottom: 8 }}>
                                  {leaverM365Actions.approval_status === 'pending' && (
                                    <div style={{ background: 'rgba(255,248,225,.5)', border: '1px solid #ffe0b2', borderRadius: 6, padding: 10 }}>
                                      <p style={{ margin: 0, fontSize: 13, color: '#e65100', fontWeight: 600 }}>Schedule awaiting approval</p>
                                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>
                                        Sent {leaverM365Actions.approval_sent_at ? `on ${new Date(leaverM365Actions.approval_sent_at).toLocaleString('en-GB')}` : ''}
                                      </p>
                                    </div>
                                  )}
                                  {leaverM365Actions.approval_status === 'approved' && (
                                    <div>
                                      <div style={{ background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                        <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Schedule approved — ready to create</p>
                                      </div>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverScheduleCreating}
                                        onClick={e => { e.stopPropagation(); leaverCreateSchedule(record) }}
                                        style={{ background: '#0078D4' }}>
                                        {leaverScheduleCreating ? 'Creating...' : 'Create Schedule'}
                                      </button>
                                    </div>
                                  )}
                                  {leaverM365Actions.approval_status === 'declined' && (
                                    <div>
                                      <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                        <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Schedule approval declined</p>
                                      </div>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverM365ApprovalSending}
                                        onClick={e => { e.stopPropagation(); leaverSendScheduleApproval(record) }}
                                        style={{ background: '#0078D4' }}>
                                        Re-send for Approval
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Schedule tracking panel */}
                              {leaverM365Actions?.schedule_id && (
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                      background: leaverM365Actions.schedule_status === 'scheduled' ? '#e3f2fd' : leaverM365Actions.schedule_status === 'running' ? '#fff3e0' : leaverM365Actions.schedule_status === 'completed' ? '#e8f5e9' : leaverM365Actions.schedule_status === 'cancelled' ? '#fafafa' : leaverM365Actions.schedule_status === 'failed' || leaverM365Actions.schedule_status === 'missed' ? '#fce4ec' : leaverM365Actions.schedule_status === 'blocked' ? '#fff8e1' : '#f5f5f5',
                                      color: leaverM365Actions.schedule_status === 'scheduled' ? '#1565c0' : leaverM365Actions.schedule_status === 'running' ? '#e65100' : leaverM365Actions.schedule_status === 'completed' ? '#2e7d32' : leaverM365Actions.schedule_status === 'cancelled' ? '#888' : leaverM365Actions.schedule_status === 'failed' || leaverM365Actions.schedule_status === 'missed' ? '#c62828' : leaverM365Actions.schedule_status === 'blocked' ? '#f57f17' : '#666',
                                    }}>
                                      {leaverM365Actions.schedule_status === 'scheduled' ? 'Scheduled' : leaverM365Actions.schedule_status === 'running' ? 'Running' : leaverM365Actions.schedule_status === 'completed' ? 'Completed' : leaverM365Actions.schedule_status === 'cancelled' ? 'Cancelled' : leaverM365Actions.schedule_status === 'failed' ? 'Failed' : leaverM365Actions.schedule_status === 'blocked' ? 'Blocked' : (leaverM365Actions.schedule_status || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                    </span>
                                    <span style={{ fontSize: 12, color: '#666', flex: 1 }}>
                                      {(() => {
                                        const stages = leaverM365Actions.schedule_stages
                                        const s0Done = stages && Array.isArray(stages) && stages[0]?.status === 'done'
                                        if (leaverM365Actions.schedule_status === 'scheduled' && s0Done) {
                                          const s0Date = stages[0].dueAt ? new Date(stages[0].dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
                                          const s1Date = stages[1]?.dueAt ? new Date(stages[1].dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
                                          return `Sign-in blocked on ${s0Date}${s1Date ? `; licence removal on ${s1Date}` : ''}`
                                        }
                                        if (leaverM365Actions.schedule_status === 'scheduled' && leaverM365Actions.schedule_next_due_at)
                                          return `Sign-in block scheduled for ${new Date(leaverM365Actions.schedule_next_due_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                                        if (leaverM365Actions.schedule_status === 'scheduled') return 'Account offboarding is scheduled'
                                        if (leaverM365Actions.schedule_status === 'running') return 'Account offboarding is in progress...'
                                        if (leaverM365Actions.schedule_status === 'completed') return 'Account offboarding complete'
                                        if (leaverM365Actions.schedule_status === 'cancelled') return 'This schedule was cancelled'
                                        if (leaverM365Actions.schedule_status === 'failed') return 'Offboarding failed — you can create a new schedule'
                                        if (leaverM365Actions.schedule_status === 'blocked') return 'Offboarding is blocked — check licence availability'
                                        return ''
                                      })()}
                                    </span>
                                    <button className="admin-btn-sm" style={{ padding: '2px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                                      disabled={leaverScheduleRefreshing}
                                      onClick={async e => { e.stopPropagation(); setLeaverScheduleRefreshing(true); await callIfoLeaver('get-leaver-schedule', { schedule_id: leaverM365Actions!.schedule_id!, offboarding_id: record.id }); await loadLeaverM365Actions(record.id); setLeaverScheduleRefreshing(false) }}>
                                      {leaverScheduleRefreshing ? <><div style={{ width: 12, height: 12, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} /> Updating...</> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refresh</>}
                                    </button>
                                  </div>
                                  {leaverM365Actions.schedule_stages && Array.isArray(leaverM365Actions.schedule_stages) && leaverM365Actions.schedule_stages.filter((s: any) => s.name).length > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                                      {leaverM365Actions.schedule_stages.filter((s: any) => s.name).map((stage: any, si: number) => {
                                        const stageDate = stage.dueAt || stage.scheduledAt
                                        const isDone = stage.status === 'done' || stage.status === 'completed'
                                        return (
                                          <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'rgba(255,255,255,.6)', borderRadius: 4, border: '1px solid #e0e0e0', flexWrap: 'wrap' }}>
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                              background: isDone ? '#4caf50' : stage.status === 'running' ? '#ff9800' : stage.status === 'failed' ? '#f44336' : stage.status === 'skipped' ? '#bbb' : '#90caf9',
                                            }} />
                                            <span style={{ fontWeight: 600 }}>{stage.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                                            <span style={{ color: '#888' }}>{stageDate ? new Date(stageDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
                                            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500,
                                              color: isDone ? '#2e7d32' : stage.status === 'running' ? '#e65100' : stage.status === 'failed' ? '#c62828' : '#888',
                                            }}>{isDone ? 'Done' : stage.status === 'pending' ? 'Waiting' : (stage.status || '').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                                            {isDone && stage.result?.userPrincipalName && (
                                              <span style={{ width: '100%', fontSize: 11, color: '#4caf50', paddingLeft: 16 }}>Email: {stage.result.userPrincipalName}</span>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                  {leaverM365Actions.schedule_message && !['completed', 'cancelled', 'failed'].includes(leaverM365Actions.schedule_status || '') && (
                                    <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(227,242,253,.4)', borderRadius: 4, border: '1px solid #bbdefb', fontSize: 12, color: '#1565c0' }}>
                                      {leaverM365Actions.schedule_message}
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {leaverM365Actions.schedule_status === 'blocked' && (
                                      <button className="admin-btn-sm" disabled={leaverScheduleRefreshing}
                                        onClick={e => { e.stopPropagation(); leaverRecheckSchedule(leaverM365Actions!.schedule_id!, record.id) }}>
                                        Check Again
                                      </button>
                                    )}
                                    {!['completed', 'cancelled', 'failed'].includes(leaverM365Actions.schedule_status || '') && (
                                      <button className="admin-btn-sm admin-btn-cancel" disabled={leaverScheduleCancelling}
                                        onClick={e => { e.stopPropagation(); leaverCancelSchedule(leaverM365Actions!.schedule_id!, record.id, 'Cancelled by admin') }}>
                                        {leaverScheduleCancelling ? 'Cancelling...' : 'Cancel Schedule'}
                                      </button>
                                    )}
                                    {['cancelled', 'failed'].includes(leaverM365Actions.schedule_status || '') && (
                                      <button className="admin-btn-sm" style={{ background: '#0078D4', color: '#fff', border: 'none' }}
                                        onClick={async e => {
                                          e.stopPropagation()
                                          const { error } = await supabase.from('offboarding_m365_actions').update({
                                            schedule_id: null, schedule_status: 'pending_approval', schedule_message: null,
                                            schedule_stages: null, schedule_next_due_at: null
                                          }).eq('offboarding_id', record.id)
                                          if (error) { showError('Failed to reset schedule'); return }
                                          await loadLeaverM365Actions(record.id)
                                          showSuccess('Schedule reset — ready to create a new one')
                                        }}>
                                        Create New Schedule
                                      </button>
                                    )}
                                  </div>
                                  {leaverM365Actions.schedule_status === 'completed' && leaverM365Actions.run_result && (
                                    <div style={{ marginTop: 8, background: 'rgba(232,245,233,.5)', border: '1px solid #a5d6a7', borderRadius: 6, padding: 10 }}>
                                      <p style={{ margin: 0, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>Offboarding schedule completed</p>
                                      {leaverM365Actions.run_result?.devices?.length > 0 && (
                                        <div style={{ marginTop: 6 }}>
                                          <strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Devices to recover:</strong>
                                          {leaverM365Actions.run_result.devices.map((d: any, di: number) => (
                                            <div key={di} style={{ fontSize: 12, padding: '2px 0' }}>
                                              <strong>{d.deviceName}</strong> — {d.operatingSystem}{d.serialNumber ? ` (S/N: ${d.serialNumber})` : ''}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Checking account */}
                              {leaverM365Actions?.run_status === 'checking_account' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 16, height: 16, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                  <span style={{ fontSize: 13 }}>Checking account status...</span>
                                </div>
                              )}

                              {/* Account blocked */}
                              {leaverM365Actions?.run_status === 'account_blocked' && (
                                <div>
                                  <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                    <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Account blocked</p>
                                    {leaverM365Actions.run_error && (
                                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                                        {leaverM365Actions.run_error.friendlyMessage || leaverM365Actions.run_error.message || leaverM365Actions.run_error.code}
                                      </p>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <button className="admin-btn-sm" disabled={leaverM365RunPolling}
                                      onClick={e => { e.stopPropagation(); leaverM365RecheckRun(leaverM365Actions!.run_id!, record.id) }}>
                                      Done — Re-check
                                    </button>
                                    <button className="admin-btn-sm"
                                      onClick={e => { e.stopPropagation(); leaverM365MarkCompleteManual(record.id) }}>
                                      Mark Complete Manually
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Ready for approval */}
                              {leaverM365Actions?.run_status === 'ready_for_approval' && (
                                <div>
                                  {leaverM365Actions.run_result?.message && (
                                    <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text, #333)', background: 'rgba(255,255,255,.6)', padding: '8px 10px', borderRadius: 6, border: '1px solid #e0e0e0' }}>
                                      {leaverM365Actions.run_result.message}
                                    </p>
                                  )}
                                  {leaverM365Actions.approval_status === 'pending' ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e65100' }}>
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                      Waiting for approval
                                      <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>(auto-refreshing)</span>
                                    </div>
                                  ) : leaverM365Actions.approval_status === 'approved' ? (
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, color: '#2e7d32' }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                        Approved by {leaverM365Actions.approved_by}
                                      </div>
                                      <button className="admin-btn-sm admin-btn-save" disabled={leaverM365Proceeding}
                                        onClick={e => { e.stopPropagation(); leaverM365ProceedRun(record) }}>
                                        {leaverM365Proceeding ? 'Proceeding...' : 'Proceed with Offboarding'}
                                      </button>
                                    </div>
                                  ) : leaverM365Actions.approval_status === 'declined' ? (
                                    <div>
                                      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#c62828' }}>Approval declined</p>
                                      <button className="admin-btn-sm" onClick={e => { e.stopPropagation(); leaverM365SendApproval(record) }}>
                                        Re-send for Approval
                                      </button>
                                    </div>
                                  ) : (
                                    <button className="admin-btn-sm admin-btn-save" disabled={leaverM365ApprovalSending}
                                      onClick={e => { e.stopPropagation(); leaverM365SendApproval(record) }}>
                                      {leaverM365ApprovalSending ? 'Sending...' : 'Send for Approval'}
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Awaiting approval (engine processing) */}
                              {leaverM365Actions?.run_status === 'awaiting_approval' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 16, height: 16, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                  <span style={{ fontSize: 13 }}>Processing offboarding...</span>
                                  <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>(auto-refreshing)</span>
                                  <button className="admin-btn-sm" style={{ marginLeft: 8 }} disabled={leaverM365RunPolling}
                                    onClick={e => { e.stopPropagation(); leaverM365RefreshStatus(leaverM365Actions!.run_id!, record.id) }}>
                                    Refresh
                                  </button>
                                </div>
                              )}

                              {/* Deprovisioning */}
                              {leaverM365Actions?.run_status === 'deprovisioning' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 16, height: 16, border: '2px solid #ccc', borderTopColor: '#0078D4', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                  <span style={{ fontSize: 13 }}>Deprovisioning in progress...</span>
                                  <button className="admin-btn-sm" style={{ marginLeft: 8 }} disabled={leaverM365RunPolling}
                                    onClick={e => { e.stopPropagation(); leaverM365RefreshStatus(leaverM365Actions!.run_id!, record.id) }}>
                                    Refresh
                                  </button>
                                </div>
                              )}

                              {/* Completed */}
                              {leaverM365Actions?.run_status === 'completed' && (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                    M365 offboarding complete
                                  </div>
                                  {leaverM365Actions.run_result?.devices?.length > 0 && (
                                    <div style={{ marginBottom: 8 }}>
                                      <strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Devices to recover:</strong>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {leaverM365Actions.run_result.devices.map((d: any, di: number) => (
                                          <div key={di} style={{ fontSize: 12, padding: '4px 8px', background: 'rgba(255,255,255,.6)', borderRadius: 4, border: '1px solid #e0e0e0' }}>
                                            <strong>{d.deviceName}</strong> — {d.operatingSystem}{d.serialNumber ? ` (S/N: ${d.serialNumber})` : ''}{d.ownership ? ` · ${d.ownership}` : ''}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {leaverM365Actions.run_result?.keptGroups?.length > 0 && (
                                    <div style={{ marginBottom: 8 }}>
                                      <strong style={{ fontSize: 12, display: 'block', marginBottom: 4, color: '#e65100' }}>Groups kept (may need manual follow-up):</strong>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        {leaverM365Actions.run_result.keptGroups.map((g: any, gi: number) => (
                                          <span key={gi} style={{ fontSize: 12 }}>{g.name} — {g.reason}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {leaverM365Actions.run_result?.removedGroups?.length > 0 && (
                                    <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                                      Removed from {leaverM365Actions.run_result.removedGroups.length} group{leaverM365Actions.run_result.removedGroups.length !== 1 ? 's' : ''}
                                    </p>
                                  )}
                                  {leaverM365Actions.run_result?.removedLicences?.length > 0 && (
                                    <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                                      Removed {leaverM365Actions.run_result.removedLicences.length} licence{leaverM365Actions.run_result.removedLicences.length !== 1 ? 's' : ''}
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* Failed */}
                              {leaverM365Actions?.run_status === 'failed' && (
                                <div>
                                  <div style={{ background: 'rgba(255,235,238,.7)', border: '1px solid #ef9a9a', borderRadius: 6, padding: 10, marginBottom: 8 }}>
                                    <p style={{ margin: 0, fontSize: 13, color: '#c62828', fontWeight: 600 }}>Offboarding failed</p>
                                    {leaverM365Actions.run_error && (
                                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c62828' }}>
                                        {leaverM365Actions.run_error.code}: {leaverM365Actions.run_error.message}
                                      </p>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <button className="admin-btn-sm" disabled={leaverM365RunPolling}
                                      onClick={e => { e.stopPropagation(); leaverM365RecheckRun(leaverM365Actions!.run_id!, record.id) }}>
                                      Re-check
                                    </button>
                                    <button className="admin-btn-sm"
                                      onClick={e => { e.stopPropagation(); leaverM365MarkCompleteManual(record.id) }}>
                                      Mark Complete Manually
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Review Future Shifts panel */}
                          {step.key === 'review_shifts' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              {reviewShifts.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>No future shifts found. You can mark this step complete.</p>
                              ) : (
                                <>
                                  <div style={{ background: '#e3f2fd', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                                    {reviewShifts.length} future shift{reviewShifts.length !== 1 ? 's' : ''}
                                  </div>
                                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 10 }}>
                                    <thead><tr style={{ borderBottom: '1px solid #ddd' }}><th style={{ textAlign: 'left', padding: 6 }}>Date</th><th style={{ textAlign: 'left', padding: 6 }}>Shift</th><th style={{ textAlign: 'left', padding: 6 }}>Rota</th></tr></thead>
                                    <tbody>{reviewShifts.map(s => (
                                      <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: 6 }}>{new Date(s.date).toLocaleDateString('en-GB')}</td><td style={{ padding: 6 }}>{s.shift_name}</td><td style={{ padding: 6 }}>{s.rota_name}</td></tr>
                                    ))}</tbody>
                                  </table>
                                  <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); cancelAllShifts(record) }}>
                                    Cancel All Future Shifts
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Review Future Bookings panel */}
                          {step.key === 'review_bookings' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              {reviewBookings.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>No future bookings found. You can mark this step complete.</p>
                              ) : (
                                <>
                                  <div style={{ background: '#e8f5e9', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                                    {reviewBookings.length} future booking{reviewBookings.length !== 1 ? 's' : ''}
                                  </div>
                                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 10 }}>
                                    <thead><tr style={{ borderBottom: '1px solid #ddd' }}><th style={{ textAlign: 'left', padding: 6 }}>Date</th><th style={{ textAlign: 'left', padding: 6 }}>Space</th></tr></thead>
                                    <tbody>{reviewBookings.map(b => (
                                      <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: 6 }}>{new Date(b.booking_date).toLocaleDateString('en-GB')}</td><td style={{ padding: 6 }}>{b.space_name}</td></tr>
                                    ))}</tbody>
                                  </table>
                                  <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); cancelAllBookings(record) }}>
                                    Cancel All Future Bookings
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Review Benefits panel */}
                          {step.key === 'review_benefits' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              {reviewBenefits.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>No active benefit enrolments found. You can mark this step complete.</p>
                              ) : (
                                <>
                                  <div style={{ background: '#fce4ec', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                                    {reviewBenefits.length} active enrolment{reviewBenefits.length !== 1 ? 's' : ''}
                                  </div>
                                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 10 }}>
                                    <thead><tr style={{ borderBottom: '1px solid #ddd' }}><th style={{ textAlign: 'left', padding: 6 }}>Benefit</th><th style={{ textAlign: 'left', padding: 6 }}>Enrolled</th></tr></thead>
                                    <tbody>{reviewBenefits.map(b => (
                                      <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: 6 }}>{b.benefit_name}</td><td style={{ padding: 6 }}>{new Date(b.enrolled_at).toLocaleDateString('en-GB')}</td></tr>
                                    ))}</tbody>
                                  </table>
                                  <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); unenrolAllBenefits(record) }}>
                                    Unenrol All Benefits
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Review Assets panel */}
                          {step.key === 'review_assets' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              {reviewAssets.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>No company assets assigned. You can mark this step complete.</p>
                              ) : (
                                <>
                                  <div style={{ background: '#fff3e0', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, display: 'inline-block', marginBottom: 10 }}>
                                    {reviewAssets.length} assigned asset{reviewAssets.length !== 1 ? 's' : ''}
                                  </div>
                                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 10 }}>
                                    <thead><tr style={{ borderBottom: '1px solid #ddd' }}><th style={{ textAlign: 'left', padding: 6 }}>Asset</th><th style={{ textAlign: 'left', padding: 6 }}>Type</th></tr></thead>
                                    <tbody>{reviewAssets.map(a => (
                                      <tr key={a.id} style={{ borderBottom: '1px solid #eee' }}><td style={{ padding: 6 }}>{a.asset_name}</td><td style={{ padding: 6 }}>{a.asset_type}</td></tr>
                                    ))}</tbody>
                                  </table>
                                  <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); confirmAssets(record) }}>
                                    Confirm All Assets Accounted For
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Export Data panel */}
                          {step.key === 'export_data' && !done && !skipped && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#666' }}>
                                Generate a GDPR-compliant data export pack containing all personal data held for this employee. The export includes leave records, payslips, expenses, timesheets, shift history, and more.
                              </p>
                              {record.data_exported_at && (
                                <p style={{ margin: '0 0 10px', fontSize: 12, color: '#4caf50', fontWeight: 600 }}>
                                  Last exported: {new Date(record.data_exported_at!).toLocaleDateString('en-GB')}
                                </p>
                              )}
                              <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); generateDataExport(record) }}>
                                Download Data Export (ZIP)
                              </button>
                            </div>
                          )}

                          {step.key === 'reassign_reports' && !done && !skipped && reassignData && (
                            <div style={{ margin: '12px 0', padding: 14, background: '#f5f5f5', borderRadius: 10 }}>
                              <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                                <div style={{ background: '#e3f2fd', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                                  {reassignData.directReports.length} direct report{reassignData.directReports.length !== 1 ? 's' : ''}
                                </div>
                                <div style={{ background: '#fff3e0', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                                  {reassignData.pendingActions} pending action{reassignData.pendingActions !== 1 ? 's' : ''}
                                </div>
                              </div>
                              {reassignData.directReports.length === 0 && reassignData.pendingActions === 0 ? (
                                <p style={{ margin: '8px 0 0', fontSize: 13, color: '#666' }}>No direct reports or pending actions to reassign. You can mark this step complete.</p>
                              ) : (
                                <>
                                  {reassignData.directReports.length > 0 && (
                                    <div style={{ marginBottom: 10, fontSize: 13 }}>
                                      <strong>Reports:</strong> {reassignData.directReports.map(r => `${r.first_name} ${r.last_name}`).join(', ')}
                                    </div>
                                  )}
                                  <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Reassign to</label>
                                  <select value={reassignTargetId} onChange={e => setReassignTargetId(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', fontSize: 14, marginBottom: 10 }}>
                                    <option value="">Select new manager...</option>
                                    {reassignCandidates.map(c => (
                                      <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.email})</option>
                                    ))}
                                  </select>
                                  <button className="admin-btn-sm admin-btn-save" disabled={!reassignTargetId || reassignSaving} onClick={e => { e.stopPropagation(); executeReassignment(record) }}>
                                    {reassignSaving ? 'Reassigning...' : 'Reassign & Complete'}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {/* Leaver Financial Calculator — approve_resignation step only */}
                          {step.key === 'approve_resignation' && !done && !skipped && (() => {
                            const saved = record.leaver_calc_result
                            const result = leaverCalcResult || saved
                            return (
                              <div style={{ margin: '12px 0', padding: 16, background: 'linear-gradient(135deg, #f8f9ff, #f0f4ff)', borderRadius: 12, border: '1px solid #c5cae9' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1565c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                                  <strong style={{ fontSize: 14, color: '#1a1a2e' }}>Leaver Holiday & Pay Calculator</strong>
                                  <span style={{ fontSize: 11, color: '#666', marginLeft: 'auto' }}>UK Working Time Regulations 1998</span>
                                </div>

                                {!record.notice_given_by && !record.end_date && (
                                  <div style={{ padding: '10px 14px', background: '#fff8e1', borderRadius: 8, marginBottom: 12, fontSize: 13, border: '1px solid #ffe082' }}>
                                    <strong style={{ color: '#e65100' }}>Notice details needed:</strong> Set the leaving date or notice details on this record before calculating. The calculator uses the offboarding end date if set, otherwise it derives the leaving date from the notice period.
                                  </div>
                                )}

                                <button
                                  className="admin-btn-sm admin-btn-primary"
                                  disabled={leaverCalcLoading}
                                  onClick={e => { e.stopPropagation(); calculateLeaverFinancials(record) }}
                                  style={{ marginBottom: result ? 12 : 0 }}
                                >
                                  {leaverCalcLoading ? 'Calculating...' : result ? 'Recalculate' : 'Calculate Holiday Balance & Costs'}
                                </button>

                                {leaverCalcError && (
                                  <div style={{ padding: '8px 12px', background: '#ffebee', borderRadius: 8, marginTop: 8, fontSize: 13, color: '#c62828' }}>
                                    {leaverCalcError}
                                  </div>
                                )}

                                {result && (
                                  <div style={{ marginTop: 8 }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
                                      <div style={{ background: '#fff', borderRadius: 10, padding: 12, border: '1px solid #e0e0e0' }}>
                                        <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>Leaving Date</div>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>{new Date(result.leavingDate + 'T00:00:00').toLocaleDateString('en-GB')}</div>
                                        <div style={{ fontSize: 11, color: '#888' }}>{result.noticePeriodApplied}</div>
                                      </div>
                                      <div style={{ background: '#fff', borderRadius: 10, padding: 12, border: '1px solid #e0e0e0' }}>
                                        <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>Holiday Balance</div>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: result.balanceStatus === 'owed' ? '#2e7d32' : result.balanceStatus === 'overtaken' ? '#c62828' : '#666' }}>
                                          {result.balanceDays > 0 ? '+' : ''}{result.balanceDays} days
                                        </div>
                                        <div style={{ fontSize: 11, color: '#888' }}>
                                          {result.balanceStatus === 'owed' ? 'Owed to employee' : result.balanceStatus === 'overtaken' ? 'Overtaken by employee' : 'Nil balance'}
                                        </div>
                                      </div>
                                      <div style={{ background: '#fff', borderRadius: 10, padding: 12, border: '1px solid #e0e0e0' }}>
                                        <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>
                                          {result.balanceStatus === 'overtaken' ? 'Clawback Value' : 'Total Cost to Company'}
                                        </div>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
                                          {currencySymbol(currency)}{result.balanceStatus === 'overtaken' ? result.clawbackValue.toFixed(2) : result.totalEmployerCost.toFixed(2)}
                                        </div>
                                        <div style={{ fontSize: 11, color: '#888' }}>
                                          {result.balanceStatus === 'overtaken'
                                            ? `Clawback ${result.clawbackPermitted === 'yes' ? 'permitted' : 'check contract'}`
                                            : `Gross ${currencySymbol(currency)}${result.grossPayout.toFixed(2)} + NI + pension`
                                          }
                                        </div>
                                      </div>
                                    </div>

                                    {result.flags.some(f => f.startsWith('WARNING:')) && (
                                      <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 18 }}>&#9888;</span>
                                        <span style={{ fontSize: 12, color: '#856404', fontWeight: 600 }}>
                                          Missing employee data — costs may be inaccurate. See notes below.
                                        </span>
                                      </div>
                                    )}

                                    <details style={{ background: '#fff', borderRadius: 10, border: '1px solid #e0e0e0', overflow: 'hidden' }}>
                                      <summary style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#1565c0' }}>View Full Breakdown</summary>
                                      <div style={{ padding: '12px 14px', fontSize: 13, lineHeight: 1.6 }}>
                                        <div style={{ marginBottom: 12 }}>
                                          <strong>1. Key Dates</strong>
                                          <div>Leave year: {new Date(result.leaveYearStart + 'T00:00:00').toLocaleDateString('en-GB')} to {new Date(result.leaveYearEnd + 'T00:00:00').toLocaleDateString('en-GB')}</div>
                                          <div>Leaving date: {new Date(result.leavingDate + 'T00:00:00').toLocaleDateString('en-GB')} ({result.noticeBasis})</div>
                                        </div>
                                        <div style={{ marginBottom: 12 }}>
                                          <strong>2. Entitlement</strong>
                                          <div>Full-year entitlement: {result.fullYearEntitlement} days (statutory min: {result.statutoryMinimum} — {result.statutoryCheck})</div>
                                          <div>Pro-rata accrued: {result.accruedDays} days ({result.daysElapsed}/{result.daysInYear} of year)</div>
                                          <div>Carry-over: {result.carryOverDays} days</div>
                                          <div><strong>Total available: {result.totalAvailable} days</strong></div>
                                        </div>
                                        <div style={{ marginBottom: 12 }}>
                                          <strong>3. Leave Used</strong>
                                          <div>Already taken: {result.leaveTakenDays} days</div>
                                          <div>Booked before leaving: {result.leaveBookedBeforeLeavingDays} days</div>
                                          <div>Bank holidays: {result.bankHolidaysUsed} days</div>
                                          <div><strong>Total used: {result.totalUsed} days</strong></div>
                                          {result.leaveToCancel.length > 0 && (
                                            <div style={{ color: '#c62828', marginTop: 4 }}>To cancel: {result.leaveToCancel.join('; ')}</div>
                                          )}
                                        </div>
                                        <div style={{ marginBottom: 12 }}>
                                          <strong>4. Balance</strong>
                                          <div>Unrounded: {result.balanceUnrounded} days</div>
                                          <div>Rounded (nearest half day): <strong>{result.balanceDays} days</strong> ({result.balanceHours} hours)</div>
                                        </div>
                                        <div style={{ marginBottom: 12 }}>
                                          <strong>5. Cost</strong>
                                          <div>Day rate: {currencySymbol(currency)}{result.dayRate.toFixed(2)}</div>
                                          {result.balanceStatus === 'owed' && (
                                            <>
                                              <div>Gross payout: {currencySymbol(currency)}{result.grossPayout.toFixed(2)}</div>
                                              <div>Employer NI (13.8%): {currencySymbol(currency)}{result.employerNI.toFixed(2)}</div>
                                              <div>Employer pension: {currencySymbol(currency)}{result.employerPension.toFixed(2)}</div>
                                              <div><strong>Total employer cost: {currencySymbol(currency)}{result.totalEmployerCost.toFixed(2)}</strong></div>
                                            </>
                                          )}
                                          {result.balanceStatus === 'overtaken' && (
                                            <>
                                              <div>Clawback value: {currencySymbol(currency)}{result.clawbackValue.toFixed(2)}</div>
                                              <div>Clawback permitted: {result.clawbackPermitted}</div>
                                            </>
                                          )}
                                        </div>
                                        {result.flags.length > 0 && (
                                          <div>
                                            {result.flags.some(f => f.startsWith('WARNING:')) && (
                                              <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
                                                <strong style={{ color: '#856404' }}>Missing Data</strong>
                                                <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: '#856404' }}>
                                                  {result.flags.filter(f => f.startsWith('WARNING:')).map((f, i) => (
                                                    <li key={i} style={{ marginBottom: 2 }}>{f.replace('WARNING: ', '')}</li>
                                                  ))}
                                                </ul>
                                              </div>
                                            )}
                                            <strong>6. Notes & Assumptions</strong>
                                            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                                              {result.flags.filter(f => !f.startsWith('WARNING:')).map((f, i) => (
                                                <li key={i} style={{ marginBottom: 2, color: f.startsWith('NOTE:') ? '#0d6efd' : undefined }}>
                                                  {f.startsWith('NOTE: ') ? f.replace('NOTE: ', '') : f}
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                      </div>
                                    </details>

                                    <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
                                      Calculated {new Date(result.calculatedAt).toLocaleDateString('en-GB')} {new Date(result.calculatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — all data processed locally, nothing sent externally
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          <div className="admin-wf-actions">
                            {done ? (
                              <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteOffboardStep(step.key) }}>Undo</button>
                            ) : skipped ? (
                              <>
                                <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeOffboardStep(step.key) }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                  Mark Complete
                                </button>
                                <button className="admin-btn-sm admin-btn-cancel" onClick={e => { e.stopPropagation(); uncompleteOffboardStep(step.key) }}>Undo Skip</button>
                              </>
                            ) : step.key === 'reassign_reports' && reassignData && (reassignData.directReports.length > 0 || reassignData.pendingActions > 0) ? (
                              <button className="admin-btn-sm admin-btn-skip" onClick={e => { e.stopPropagation(); skipOffboardStep(step.key) }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                                Skip
                              </button>
                            ) : (
                              <>
                                <button className="admin-btn-sm admin-btn-save" onClick={e => { e.stopPropagation(); completeOffboardStep(step.key) }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                  Mark Complete
                                </button>
                                <button className="admin-btn-sm admin-btn-skip" onClick={e => { e.stopPropagation(); skipOffboardStep(step.key) }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
                                  Skip
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Timing Advisory Modal — warns when completing post-leave-date steps early */}
      {timingWarningStep && (() => {
        const record = offboardRecords.find(r => r.id === offboardSelectedId)
        const stepDef = OFFBOARD_STEPS.find(s => s.key === timingWarningStep)
        const stepReasons: Record<string, string> = {
          remove_accounts: 'Removing accounts and licences before the last working day may prevent the employee from accessing systems they still need. Unless the employee is on garden leave or PILON, this should wait until end of day on their leave date.',
          convert_shared_mailbox: 'Converting the mailbox before the employee leaves means they will lose access to their own email. This is typically done after the last working day.',
          forward_to_manager: 'Setting up email forwarding before departure means the employee may see forwarded copies. This is typically configured on or after the last day.',
          confirm_payments: 'Final pay confirmation should include all accrued holiday, expenses and deductions up to the leave date. Confirming early may mean the calculation is incomplete. The P45 must follow final pay — issuing it before creates tax complications.',
        }
        if (!record || !stepDef) return null
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 440, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fff8e1', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f57f17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Before the leave date</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
                  <strong>{stepDef.label}</strong> is typically completed on or after the last working day ({record.end_date ? new Date(record.end_date).toLocaleDateString('en-GB') : 'not set'}).
                </p>
              </div>
              <div style={{ background: '#fffde7', border: '1px solid #fff9c4', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: '#5d4037', lineHeight: 1.5 }}>
                {stepReasons[timingWarningStep] || 'This step is usually completed after the employee has left. Completing it now may have unintended consequences.'}
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="admin-btn" style={{ background: '#e0e0e0', color: '#333', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => setTimingWarningStep(null)}>
                  Go Back
                </button>
                <button className="admin-btn" style={{ background: '#f57f17', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}
                  onClick={() => completeOffboardStep(timingWarningStep, true)}>
                  Complete Anyway
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Freeze Confirmation Modal */}
      {showFreezeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 480, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff3e0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Freeze Employee Account</h3>
              <p style={{ margin: '0 0 12px', color: '#666', fontSize: 14, lineHeight: 1.5 }}>
                This will prevent <strong>{showFreezeModal.employee_name}</strong> from logging into the HR app and place them in the 30-day deletion queue.
              </p>
            </div>
            <div style={{ background: '#f9f9f9', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13 }}>
              <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 14 }}>What will happen:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#4caf50' }}>✓</span> Employee login disabled</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#4caf50' }}>✓</span> GDPR data export auto-generated</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#4caf50' }}>✓</span> Employee marked as frozen</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#4caf50' }}>✓</span> 30-day deletion countdown starts</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#f57c00' }}>!</span> All data permanently deleted after 30 days</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#2196f3' }}>i</span> Deletion certificate produced on expiry</div>
              </div>
              {(() => {
                const incompleteSteps = OFFBOARD_STEPS.filter(s => !offboardChecks[s.key] && !offboardSkips[s.key] && s.key !== 'confirm_payments')
                if (incompleteSteps.length > 0) return (
                  <div style={{ marginTop: 10, padding: 10, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffe0b2' }}>
                    <p style={{ margin: 0, fontSize: 12, color: '#e65100', fontWeight: 600 }}>{incompleteSteps.length} workflow step{incompleteSteps.length !== 1 ? 's' : ''} not yet completed:</p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>{incompleteSteps.map(s => s.label).join(', ')}</p>
                  </div>
                )
                return null
              })()}
              {(features.xero_integration || features.sage_integration) && showFreezeModal.status !== 'final_run_complete' && (
                <div style={{ marginTop: 10, padding: 10, background: '#fce4ec', borderRadius: 8, border: '1px solid #f8bbd0' }}>
                  <p style={{ margin: 0, fontSize: 12, color: '#c62828', fontWeight: 600 }}>Payroll warning: Final pay run has not been confirmed</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#b71c1c' }}>Ensure the employee's final payslip is processed in {features.xero_integration ? 'Xero' : 'Sage'} before freezing. You can still proceed, but the final pay run must be handled separately.</p>
                </div>
              )}
              {showFreezeModal.end_date && new Date() < new Date(showFreezeModal.end_date + 'T23:59:59') && (
                <div style={{ marginTop: 10, padding: 10, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffe0b2' }}>
                  <p style={{ margin: 0, fontSize: 12, color: '#e65100', fontWeight: 600 }}>Leave date has not passed</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>The leave date is {new Date(showFreezeModal.end_date).toLocaleDateString('en-GB')}. Freezing now will immediately disable their InflowHR login and start the 30-day deletion countdown. If M365 offboarding is scheduled, it will continue independently.</p>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="admin-btn" style={{ background: '#e0e0e0', color: '#333', border: 'none', padding: '10px 24px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }} onClick={() => freezeEmployee(showFreezeModal, false)}>
                Decline
              </button>
              <button className="admin-btn" style={{ background: '#c62828', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }} onClick={() => freezeEmployee(showFreezeModal, true)}>
                Approve & Freeze
              </button>
            </div>
          </div>
        </div>
      )}

      {(tab === 'movers' || (tab === 'jml' && jmlSection === 'movers')) && (
        <div>
          <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 24, border: '1px solid var(--admin-border, #e0e0e0)', marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: '#e65100' }}>Start Role Change</h3>
            {(() => { const g = getFunctionGating('movers'); return g.blocked ? (
              <div style={{ marginBottom: 12, padding: 12, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffe0b2' }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e65100' }}>Mover provisioning: {g.message}</p>
                {g.reason && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#bf360c' }}>{g.reason}</p>}
              </div>
            ) : null })()}
            <div style={{ marginBottom: 16, display: getFunctionGating('movers').blocked ? 'none' : undefined }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Search Employee</label>
              <input
                type="text"
                className="admin-input"
                placeholder="Type employee name..."
                value={moverEmployeeSearch}
                onChange={async (e) => {
                  setMoverEmployeeSearch(e.target.value)
                  if (e.target.value.length >= 2) {
                    const { data } = await supabase.from('employees').select('id, first_name, last_name, email, work_email, job_title, department, manager_name, manager_email, location, persona, has_company_device')
                      .eq('company_id', selectedCompanyId).or(`first_name.ilike.%${e.target.value}%,last_name.ilike.%${e.target.value}%,email.ilike.%${e.target.value}%`).limit(10)
                    setMoverEmployeeResults((data || []).map((e: any) => ({ ...e, email: e.email || '', work_email: e.work_email || e.email || '' })))
                  } else {
                    setMoverEmployeeResults([])
                  }
                }}
                style={{ width: '100%', maxWidth: 400 }}
              />
              {moverEmployeeResults.length > 0 && !moverSelectedEmployee && (
                <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, marginTop: 4, maxWidth: 400, maxHeight: 200, overflowY: 'auto' }}>
                  {moverEmployeeResults.map((emp: any) => (
                    <div key={emp.id} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}
                      onClick={() => {
                        setMoverSelectedEmployee(emp)
                        setMoverEmployeeSearch(`${emp.first_name} ${emp.last_name}`)
                        setMoverEmployeeResults([])
                        setMoverForm({ employee_id: emp.id, employee_name: `${emp.first_name} ${emp.last_name}`, employee_email: emp.work_email || emp.email, changes: {}, change_type: 'persona_change', reason: '', additionalFields: [] })
                      }}>
                      <span style={{ fontWeight: 600 }}>{emp.first_name} {emp.last_name}</span>
                      <span style={{ color: '#666', marginLeft: 8 }}>{emp.job_title} · {emp.department}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {moverSelectedEmployee && !getFunctionGating('movers').blocked && (
              <div>
                <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{moverSelectedEmployee.first_name} {moverSelectedEmployee.last_name}</div>
                      <div style={{ fontSize: 13, color: '#666' }}>{moverSelectedEmployee.email}</div>
                    </div>
                    <button className="admin-btn-sm" onClick={() => { setMoverSelectedEmployee(null); setMoverEmployeeSearch(''); setMoverForm({}) }}>Clear</button>
                  </div>
                  {identityProvider !== 'google_workspace' && (
                    <div style={{ fontSize: 13 }}>
                      Current Persona: <span style={{ fontWeight: 600, color: ENGINE_PERSONA_COLORS[moverSelectedEmployee.persona || 'information-worker']?.color || '#333' }}>
                        {enginePersonas.find(ep => ep.id === (moverSelectedEmployee.persona || 'information-worker'))?.name || moverSelectedEmployee.persona || 'Information worker'}
                      </span>
                    </div>
                  )}
                </div>

                {identityProvider !== 'google_workspace' && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>New Persona</label>
                  {!moverSelectedEmployee.has_company_device ? (
                    <div style={{ padding: '12px 16px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, fontSize: 13, color: '#6d4c00' }}>
                      This employee doesn't have a managed company device — persona changes are not applicable. To enable persona changes, tick "Company Device" on the employee record first.
                    </div>
                  ) : enginePersonas.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                      {enginePersonas.map(ep => {
                        const colours = ENGINE_PERSONA_COLORS[ep.id] || { color: '#555', bg: '#f5f5f5' }
                        const currentPersona = moverSelectedEmployee.persona || 'information-worker'
                        const isCurrent = currentPersona === ep.id
                        const isSelected = moverForm.changes?.persona?.new === ep.id
                        const disabled = isCurrent || ep.ready === false
                        return (
                          <div key={ep.id}
                            onClick={() => {
                              if (disabled) return
                              setMoverForm({
                                ...moverForm,
                                changes: { ...moverForm.changes, persona: { old: currentPersona, new: ep.id } }
                              })
                            }}
                            style={{
                              border: `2px solid ${isSelected ? colours.color : isCurrent ? '#16a34a' : '#e0e0e0'}`,
                              borderRadius: 10, padding: '12px 14px', cursor: disabled ? 'default' : 'pointer',
                              background: isSelected ? colours.bg : isCurrent ? '#f0fdf4' : '#fff',
                              opacity: disabled ? 0.5 : 1,
                            }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: colours.color, marginTop: 4 }}>{ep.name}</div>
                            {ep.description && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{ep.description}</div>}
                            {isCurrent && <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', marginTop: 4 }}>CURRENT</div>}
                            {isSelected && <div style={{ fontSize: 10, fontWeight: 700, color: colours.color, marginTop: 4 }}>SELECTED</div>}
                            {ep.ready === false && <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>Not ready — {ep.setup || 'set up in InflowOnboarder'}</div>}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#888' }}>
                      {enginePersonasLoaded ? 'No persona packs enabled in InflowOnboarder.' : 'Loading personas from engine...'}
                    </div>
                  )}
                  {moverForm.changes?.persona?.new === 'secure-vip' && moverSelectedEmployee.persona !== 'secure-vip' && (
                    <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>
                      Moving to Secure VIP will revoke all active sessions for this user.
                    </div>
                  )}
                  {moverSelectedEmployee.persona === 'secure-vip' && moverForm.changes?.persona?.new && moverForm.changes.persona.new !== 'secure-vip' && (
                    <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>
                      Moving from Secure VIP will revoke all active sessions for this user.
                    </div>
                  )}
                </div>
                )}

                <div className="admin-form-grid" style={{ marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Reason</label>
                    <input className="admin-input" placeholder="Reason for role change..." value={moverForm.reason || ''} onChange={e => setMoverForm({ ...moverForm, reason: e.target.value })} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Effective Date</label>
                    <input type="date" className="admin-input" value={moverForm.effective_date || ''} onChange={e => setMoverForm({ ...moverForm, effective_date: e.target.value })} />
                  </div>
                </div>

                {/* Additional change fields — added one at a time via + button */}
                {(moverForm.additionalFields || []).length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Additional Changes</label>
                    {(moverForm.additionalFields as string[]).map((field: string) => {
                      const labels: Record<string, string> = { job_title: 'Job Title', department: 'Department', location: 'Location', manager_name: 'Manager Name', manager_email: 'Manager Email (UPN)' }
                      const currentValues: Record<string, string> = { job_title: moverSelectedEmployee.job_title || '', department: moverSelectedEmployee.department || '', location: moverSelectedEmployee.location || '', manager_name: moverSelectedEmployee.manager_name || '', manager_email: moverSelectedEmployee.manager_email || '' }
                      return (
                        <div key={field} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 12, fontWeight: 600 }}>{labels[field]} <span style={{ color: '#999', fontWeight: 400 }}>(current: {currentValues[field] || '—'})</span></label>
                            <input className="admin-input" placeholder={`New ${labels[field].toLowerCase()}...`}
                              value={moverForm.changes?.[field]?.new || ''}
                              onChange={e => setMoverForm({
                                ...moverForm,
                                changes: { ...moverForm.changes, [field]: { old: currentValues[field], new: e.target.value } }
                              })}
                              style={{ width: '100%', marginTop: 4 }}
                            />
                          </div>
                          <button onClick={() => {
                            const newFields = (moverForm.additionalFields as string[]).filter((f: string) => f !== field)
                            const newChanges = { ...moverForm.changes }
                            delete newChanges[field]
                            setMoverForm({ ...moverForm, additionalFields: newFields, changes: newChanges })
                          }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#999', fontSize: 18, marginTop: 16 }} title="Remove">
                            &times;
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* + button to add additional fields */}
                {(() => {
                  const allFields = ['job_title', 'department', 'location', 'manager_name', 'manager_email']
                  const usedFields = moverForm.additionalFields || []
                  const available = allFields.filter(f => !usedFields.includes(f))
                  if (available.length === 0) return null
                  const labels: Record<string, string> = { job_title: 'Job Title', department: 'Department', location: 'Location', manager_name: 'Manager Name', manager_email: 'Manager Email (UPN)' }
                  return (
                    <div style={{ marginBottom: 16, position: 'relative' }}>
                      <button className="admin-btn-sm" style={{ background: '#f5f5f5', border: '1px solid #e0e0e0', fontWeight: 600, fontSize: 13, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={() => setMoverForm({ ...moverForm, showFieldPicker: !moverForm.showFieldPicker })}>
                        <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add Change
                      </button>
                      {moverForm.showFieldPicker && (
                        <div style={{ position: 'absolute', top: 36, left: 0, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, minWidth: 180 }}>
                          {available.map(f => (
                            <div key={f} style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f0f0f0' }}
                              onClick={() => {
                                let newFields = [...(moverForm.additionalFields || []), f]
                                if (f === 'manager_name' && !newFields.includes('manager_email')) newFields.push('manager_email')
                                if (f === 'manager_email' && !newFields.includes('manager_name')) newFields.push('manager_name')
                                setMoverForm({ ...moverForm, additionalFields: newFields, showFieldPicker: false })
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                              {labels[f]}{(f === 'manager_name' || f === 'manager_email') && ' (adds both)'}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}

                <button className="admin-btn admin-btn-save" style={{ background: '#e65100' }}
                  onClick={async () => {
                    if (!moverForm.changes?.persona?.new) { showError('Please select a new persona tier'); return }
                    const nonEmptyChanges: Record<string, any> = {}
                    Object.entries(moverForm.changes || {}).forEach(([k, v]: [string, any]) => {
                      if (v?.new && v.new !== v.old) nonEmptyChanges[k] = v
                    })
                    if (Object.keys(nonEmptyChanges).length === 0) { showError('Please specify at least one change'); return }
                    const changeKeys = Object.keys(nonEmptyChanges)
                    const changeType = changeKeys.length > 1 ? 'multi_change' : 'persona_change'
                    const { data, error } = await supabase.from('role_changes').insert({
                      company_id: selectedCompanyId,
                      employee_id: moverForm.employee_id,
                      employee_name: moverForm.employee_name,
                      employee_email: moverForm.employee_email,
                      change_type: changeType,
                      changes: nonEmptyChanges,
                      effective_date: moverForm.effective_date || null,
                      reason: moverForm.reason || null,
                      requested_by: session?.user?.id,
                    }).select().single()
                    if (error) { showError(error.message); return }
                    setMoverSelectedEmployee(null); setMoverEmployeeSearch(''); setMoverForm({})
                    setMoverSelectedId(data.id); setMoverStep(0); setMoverChecks({}); setMoverSkips({})
                    await loadMovers()
                    setTab('mover-workflow')
                    showSuccess('Role change created')
                  }}>
                  Start Role Change
                </button>
              </div>
            )}
          </div>

          {activeMoverRecords.length > 0 && (
            <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 24, border: '1px solid var(--admin-border, #e0e0e0)', marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: '#e65100' }}>Active Role Changes</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Change Summary</th>
                      <th>Persona</th>
                      <th>Effective Date</th>
                      <th>Approver</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedActiveMovers.map(rc => {
                      const personaChange = rc.changes?.persona
                      const m365 = moverM365[rc.id]
                      const isDeclined = m365?.persona_schedule_status === 'declined' || m365?.approval_status === 'declined'
                      const declineExpanded = expandedMoverDeclineId === rc.id
                      const changeSummary = Object.keys(rc.changes || {}).filter(k => k !== 'persona').map(k => {
                        const v = rc.changes[k]
                        return `${k.replace(/_/g, ' ')}: ${v?.old || '—'} → ${v?.new || '—'}`
                      }).join(', ')
                      return (
                        <Fragment key={rc.id}>
                        <tr>
                          <td><strong>{rc.employee_name}</strong><br /><span style={{ fontSize: 11, color: '#666' }}>{rc.employee_email}</span></td>
                          <td style={{ fontSize: 12 }}>{changeSummary || '—'}</td>
                          <td>{personaChange ? (
                            <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#fff3e0', color: '#e65100', fontWeight: 600 }}>
                              {enginePersonas.find(ep => ep.id === resolvePersonaId(personaChange.old))?.name || resolvePersonaId(personaChange.old)} → {enginePersonas.find(ep => ep.id === resolvePersonaId(personaChange.new))?.name || resolvePersonaId(personaChange.new)}
                            </span>
                          ) : '—'}</td>
                          <td>{rc.effective_date ? new Date(rc.effective_date).toLocaleDateString('en-GB') : '—'}</td>
                          <td style={{ fontSize: 12 }}>{m365?.declined_by || m365?.approved_by || '—'}</td>
                          <td>
                            <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, fontWeight: 600,
                              background: rc.status === 'completed' ? '#dcfce7' : rc.status === 'in_progress' ? '#fff3e0' : rc.status === 'cancelled' ? (isDeclined ? '#fef2f2' : '#f5f5f5') : '#e3f2fd',
                              color: rc.status === 'completed' ? '#16a34a' : rc.status === 'in_progress' ? '#e65100' : rc.status === 'cancelled' ? (isDeclined ? '#dc2626' : '#9e9e9e') : '#1565c0',
                            }}>{isDeclined ? 'Declined' : rc.status}</span>
                            {isDeclined && m365?.decline_reason && (
                              <span onClick={() => setExpandedMoverDeclineId(declineExpanded ? null : rc.id)} style={{ cursor: 'pointer', marginLeft: 6, fontSize: 11, color: '#888', userSelect: 'none', display: 'inline-block', transform: declineExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
                            )}
                          </td>
                          <td>
                            <button className="admin-btn-sm admin-btn-save" style={{ background: '#e65100' }} onClick={() => {
                              setMoverSelectedId(rc.id)
                              setMoverStep(0)
                              setMoverChecks(rc.workflow_steps || {})
                              setMoverSkips(rc.skipped_steps || {})
                              setTab('mover-workflow')
                            }}>Workflow</button>
                            {(rc.status === 'pending' || rc.status === 'in_progress') && (
                              <button className="admin-btn-sm" style={{ marginLeft: 8, color: '#c62828', border: '1px solid #c62828' }} onClick={() => cancelMoverRoleChange(rc)}>Cancel</button>
                            )}
                            <button className="admin-btn-sm" style={{ marginLeft: 8, color: '#9e9e9e', border: '1px solid #ccc' }} onClick={() => deleteMoverRoleChange(rc)}>Delete</button>
                          </td>
                        </tr>
                        {isDeclined && declineExpanded && m365?.decline_reason && (
                          <tr>
                            <td colSpan={7} style={{ padding: '0 16px 12px', background: '#fef2f2' }}>
                              <div style={{ padding: 12, borderRadius: 8, fontSize: 12 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 8 }}>
                                  <div><strong style={{ color: '#888' }}>Submitted</strong><br />{m365?.created_at ? new Date(m365.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                                  <div><strong style={{ color: '#888' }}>Declined</strong><br />{m365?.declined_at ? new Date(m365.declined_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                                  <div><strong style={{ color: '#888' }}>Declined by</strong><br />{m365?.declined_by || '—'}</div>
                                </div>
                                <div><strong style={{ color: '#888' }}>Reason:</strong> {m365.decline_reason}</div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {moverTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                  <button className="admin-btn-sm" disabled={moverPage <= 1} onClick={() => setMoverPage(p => p - 1)}>Prev</button>
                  <span style={{ fontSize: 13, lineHeight: '32px' }}>Page {moverPage} of {moverTotalPages}</span>
                  <button className="admin-btn-sm" disabled={moverPage >= moverTotalPages} onClick={() => setMoverPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}

          {completedMoverRecords.length > 0 && (
            <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 24, border: '1px solid var(--admin-border, #e0e0e0)' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: '#16a34a' }}>Completed / Cancelled</h3>
              {completedMoverRecords.slice(0, 10).map(rc => {
                const expanded = expandedMoverCompletedId === rc.id
                const isCancelled = rc.status === 'cancelled'
                const m365 = moverM365[rc.id]
                return (
                  <div key={rc.id} style={{ borderBottom: '1px solid #e0e0e0', padding: '10px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setExpandedMoverCompletedId(expanded ? null : rc.id)}>
                      <span style={{ fontSize: 12, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
                      <strong style={{ fontSize: 13 }}>{rc.employee_name}</strong>
                      <span style={{ fontSize: 12, color: '#666' }}>{rc.change_type.replace(/_/g, ' ')}</span>
                      {isCancelled && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#fef2f2', color: '#dc2626', fontWeight: 600 }}>Cancelled</span>}
                      <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto' }}>{rc.completed_at ? new Date(rc.completed_at).toLocaleDateString('en-GB') : new Date(rc.created_at).toLocaleDateString('en-GB')}</span>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 8, padding: 12, background: isCancelled ? '#fef2f2' : '#f5f5f5', borderRadius: 8, fontSize: 12 }}>
                        {isCancelled && m365?.decline_reason && (
                          <div style={{ marginBottom: 8, padding: 8, background: '#fee2e2', borderRadius: 6, border: '1px solid #fecaca' }}>
                            <strong style={{ color: '#dc2626' }}>Decline Reason:</strong> {m365.decline_reason}
                            {m365.declined_by && <div style={{ marginTop: 4, color: '#666' }}>Declined by: {m365.declined_by}</div>}
                            {m365.declined_at && <div style={{ color: '#666' }}>Declined: {new Date(m365.declined_at).toLocaleDateString('en-GB')}</div>}
                          </div>
                        )}
                        {Object.entries(rc.changes || {}).map(([k, v]: [string, any]) => (
                          <div key={k} style={{ marginBottom: 4, textDecoration: isCancelled ? 'line-through' : 'none', color: isCancelled ? '#999' : undefined }}>
                            <strong>{k.replace(/_/g, ' ')}:</strong> {v?.old || '—'} → {v?.new || '—'}
                          </div>
                        ))}
                        {rc.reason && <div style={{ marginTop: 4, color: '#666' }}>Reason: {rc.reason}</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'mover-workflow' && (() => {
        try {
        const rc = moverRecords.find(r => r.id === moverSelectedId)
        if (!rc) return <p>Select a role change from the Movers tab.</p>
        const m365 = moverM365[rc.id]
        const steps = MOVER_STEPS
        const currentStep = steps[moverStep] || steps[0]
        const progressPct = Math.round((Object.keys(moverChecks).filter(k => moverChecks[k]).length / steps.length) * 100)

        const isDeclined = rc.status === 'cancelled' && (m365?.persona_schedule_status === 'declined' || m365?.approval_status === 'declined')

        return (
          <div>
            {isDeclined && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>❌</span>
                  <strong style={{ color: '#dc2626', fontSize: 15 }}>Approval Declined</strong>
                </div>
                <div style={{ fontSize: 13, color: '#991b1b' }}>
                  This role change was declined{m365?.declined_by ? ` by ${m365.declined_by}` : ''}{m365?.declined_at ? ` on ${new Date(m365.declined_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}.
                  {m365?.decline_reason && <><br /><strong>Reason:</strong> {m365.decline_reason}</>}
                </div>
                <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>All steps have been cancelled and any applied changes have been reverted. This role change will need to be started again.</div>
              </div>
            )}
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
            <div>
              <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 16, border: '1px solid var(--admin-border, #e0e0e0)', marginBottom: 16 }}>
                <h4 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: isDeclined ? '#dc2626' : '#e65100' }}>{rc.employee_name || '—'}</h4>
                <p style={{ margin: 0, fontSize: 12, color: '#666' }}>{(rc.change_type || '').replace(/_/g, ' ')} · {isDeclined ? 'Declined' : (rc.status || 'pending')}</p>
                <div style={{ marginTop: 10, background: '#f1f5f9', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progressPct}%`, background: isDeclined ? '#dc2626' : 'linear-gradient(90deg, #e65100, #ff9800)', borderRadius: 6, transition: 'width 0.3s' }} />
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#888' }}>{progressPct}% complete</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {steps.map((step, i) => {
                  const done = moverChecks[step.key]
                  const skipped = moverSkips[step.key]
                  const isCurrent = i === moverStep
                  const isDeclinedSkip = skipped && rc.status === 'cancelled' && (m365?.persona_schedule_status === 'declined' || m365?.approval_status === 'declined')
                  return (
                    <div key={step.key}
                      className={`admin-wf-step ${done ? 'admin-wf-done' : ''} ${skipped ? 'admin-wf-skipped' : ''} ${isCurrent ? 'admin-wf-current' : ''}`}
                      onClick={() => setMoverStep(i)}
                      style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                        background: isCurrent ? '#fff3e0' : done ? '#f0fdf4' : isDeclinedSkip ? '#fef2f2' : skipped ? '#f5f5f5' : 'transparent',
                        border: isCurrent ? '1px solid #e65100' : '1px solid transparent',
                      }}>
                      <span style={{ fontSize: 16 }}>{done ? '✅' : isDeclinedSkip ? '❌' : skipped ? '⏭️' : step.icon}</span>
                      <span style={{ fontWeight: isCurrent ? 700 : 400, color: done ? '#16a34a' : isDeclinedSkip ? '#dc2626' : skipped ? '#999' : isCurrent ? '#e65100' : 'inherit' }}>{step.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 24, border: '1px solid var(--admin-border, #e0e0e0)' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: '#e65100' }}>{currentStep.icon} {currentStep.label}</h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: '#666' }}>{currentStep.description}</p>

              {currentStep.key === 'review_changes' && (
                <div>
                  <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Proposed Changes</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {Object.entries(rc.changes || {}).map(([field, val]: [string, any]) => (
                      <div key={field} style={{ background: '#f5f5f5', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>{field.replace(/_/g, ' ')}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, color: '#c62828', textDecoration: 'line-through' }}>{val?.old || '—'}</span>
                          <span style={{ fontSize: 13 }}>→</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#2e7d32' }}>{val?.new || '—'}</span>
                        </div>
                        {field === 'persona' && (
                          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                            {[val?.old, val?.new].map((pId, idx) => {
                              const ep = enginePersonas.find(p => p.id === pId)
                              const colours = ENGINE_PERSONA_COLORS[pId] || { color: '#555', bg: '#f5f5f5' }
                              return <div key={idx} style={{ background: colours.bg, border: `1px solid ${colours.color}33`, borderRadius: 8, padding: '6px 10px', flex: 1 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: colours.color }}>{ep?.name || pId}</div>
                              </div>
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {(rc.changes?.persona?.new === 'secure-vip' || rc.changes?.persona?.old === 'secure-vip') && (
                    <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#dc2626' }}>
                      This persona transition crosses a security boundary. All active user sessions will be revoked.
                    </div>
                  )}
                </div>
              )}

              {currentStep.key === 'update_accounts' && (() => {
                try {
                return (
                <div>
                  <div style={{ padding: '10px 14px', background: '#f5f5f5', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                    <strong>Employee:</strong> {rc.employee_name || '—'} · <strong>UPN:</strong> {rc.employee_email || '—'}
                  </div>
                  {identityProvider === 'google_workspace' ? (
                    <div style={{ padding: '12px 16px', background: '#f5f5f5', borderRadius: 8, fontSize: 13, color: '#666' }}>
                      M365 provisioning is not available for Google Workspace companies. Create accounts manually.
                    </div>
                  ) : features.inflowonboarder_integration && ifoConnected ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {/* ── M365 Mover Run (profile, manager, groups, licence) ── */}
                      {(() => {
                        const ch = rc.changes || {}
                        const hasProfileChanges = ch.job_title || ch.department || ch.location
                        const hasManagerChanges = ch.manager_name || ch.manager_email
                        const hasNonPersonaChanges = hasProfileChanges || hasManagerChanges
                        if (!hasNonPersonaChanges) return (
                          <div style={{ padding: '10px 14px', background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: 8, fontSize: 13, color: '#2e7d32' }}>
                            No profile or manager changes — M365 mover run not required.{ch.persona ? ' Persona change is handled separately below.' : ''}
                          </div>
                        )

                        const buildEngineChanges = () => {
                          const engineChanges: Record<string, any> = {}
                          if (hasProfileChanges) {
                            const profile: Record<string, string> = {}
                            if (ch.job_title?.new) profile.jobTitle = ch.job_title.new
                            if (ch.department?.new) profile.department = ch.department.new
                            if (ch.location?.new) profile.officeLocation = ch.location.new
                            engineChanges.profile = profile
                          }
                          if (hasManagerChanges && ch.manager_email?.new) {
                            engineChanges.manager = { userPrincipalName: ch.manager_email.new }
                          }
                          return engineChanges
                        }

                        return (
                          <div>
                            <h5 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>M365 Account Changes</h5>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, fontSize: 13 }}>
                              {ch.job_title && <div><strong>Job Title:</strong> {ch.job_title.old} → <span style={{ color: '#2e7d32', fontWeight: 600 }}>{ch.job_title.new}</span></div>}
                              {ch.department && <div><strong>Department:</strong> {ch.department.old} → <span style={{ color: '#2e7d32', fontWeight: 600 }}>{ch.department.new}</span></div>}
                              {ch.location && <div><strong>Location:</strong> {ch.location.old} → <span style={{ color: '#2e7d32', fontWeight: 600 }}>{ch.location.new}</span></div>}
                              {ch.manager_name && <div><strong>Manager:</strong> {ch.manager_name.old} → <span style={{ color: '#2e7d32', fontWeight: 600 }}>{ch.manager_name.new}</span></div>}
                              {ch.manager_email && <div><strong>Manager UPN:</strong> {ch.manager_email.old} → <span style={{ color: '#2e7d32', fontWeight: 600 }}>{ch.manager_email.new}</span></div>}
                            </div>
                            {(!m365 || m365.run_status === 'failed') && (
                              <button className="admin-btn admin-btn-save" style={{ background: '#e65100' }}
                                onClick={async () => {
                                  const res = await callIfoMover('start-mover-run', {
                                    role_change_id: rc.id,
                                    user_principal_name: rc.employee_email,
                                    changes: buildEngineChanges(),
                                    attempt: (m365?.attempt_count_run || 0) + 1,
                                  })
                                  if (!res) return
                                  await loadMovers()
                                  showSuccess('M365 mover run started')
                                }}>
                                {m365?.run_status === 'failed' ? 'Retry M365 Update' : 'Start M365 Update'}
                              </button>
                            )}
                            {m365 && m365.run_id && (
                              <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, fontSize: 13 }}>
                                <div style={{ marginBottom: 8 }}><strong>Status:</strong> <span style={{ color: m365.run_status === 'completed' ? '#16a34a' : m365.run_status === 'failed' ? '#dc2626' : '#e65100', fontWeight: 600 }}>{m365.run_status || 'Not started'}</span></div>
                                {m365.run_status === 'ready_for_approval' && (
                                  <div style={{ padding: '10px 14px', background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 8, marginBottom: 8 }}>
                                    Awaiting approval. The designated approver will receive a notification to review and approve the M365 changes.
                                  </div>
                                )}
                                {m365.run_status === 'completed' && m365.run_result && (
                                  <div>
                                    <h5 style={{ margin: '8px 0', fontSize: 13, fontWeight: 700 }}>Result</h5>
                                    {m365.run_result.changed && <div style={{ marginBottom: 4 }}>Changed: {JSON.stringify(m365.run_result.changed)}</div>}
                                    {m365.run_result.skipped && <div style={{ marginBottom: 4 }}>Skipped: {JSON.stringify(m365.run_result.skipped)}</div>}
                                  </div>
                                )}
                                {m365.run_error && (
                                  <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 12 }}>
                                    Error: {m365.run_error.message || JSON.stringify(m365.run_error)}
                                  </div>
                                )}
                                {m365.run_status && !['completed', 'failed'].includes(m365.run_status) && (
                                  <button className="admin-btn-sm admin-btn-save" style={{ marginTop: 8 }}
                                    onClick={async () => {
                                      await callIfoMover('check-mover-run', { role_change_id: rc.id, run_id: m365.run_id })
                                      await loadMovers()
                                    }}>
                                    Refresh Status
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })()}

                      {/* ── Persona Change (separate engine flow) ── */}
                      {(() => {
                        const hasPersonaChange = rc.changes?.persona?.old && rc.changes?.persona?.new && rc.changes.persona.old !== rc.changes.persona.new
                        if (!hasPersonaChange) return null
                        const personaOld = resolvePersonaId(rc.changes.persona.old)
                        const personaNew = resolvePersonaId(rc.changes.persona.new)
                        const personaStatus = m365?.persona_schedule_status
                        const personaCheckResult = m365?.persona_check_result

                        return (
                          <div>
                            <h5 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Persona Change</h5>
                            <div style={{ padding: '10px 14px', background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
                              <strong>{String(personaOld).replace(/_/g, ' ')}</strong> → <strong style={{ color: '#e65100' }}>{String(personaNew).replace(/_/g, ' ')}</strong>
                              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>The employee's Microsoft 365 access and security settings will be updated to match their new persona.</div>
                            </div>

                            {/* Check result display — HR-friendly */}
                            {personaCheckResult && (() => {
                              try {
                                const r = personaCheckResult
                                const currentName = typeof r.currentPersona === 'object' ? (r.currentPersona.name || r.currentPersona.id || (r.currentPersona.source === 'none' ? 'None' : '')) : String(r.currentPersona || '')
                                const targetName = typeof r.targetPersona === 'object' ? (r.targetPersona.name || r.targetPersona.id || '') : String(r.targetPersona || '')
                                const isAdmin = r.adminAccount === true
                                const needsApproval = r.approvalRequired === true
                                const warnings = Array.isArray(r.warnings) ? r.warnings : []

                                return (
                                  <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 12, fontSize: 12, marginBottom: 10 }}>
                                    <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>Check Result</div>
                                    {currentName && <div style={{ marginBottom: 4 }}>Current persona: <strong>{currentName}</strong></div>}
                                    {targetName && <div style={{ marginBottom: 6 }}>New persona: <strong>{targetName}</strong></div>}

                                    {/* Admin account warning */}
                                    {isAdmin && (
                                      <div style={{ padding: '8px 12px', background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 6, marginBottom: 8, fontSize: 12 }}>
                                        This employee has an admin account — the persona change may need to be done manually by IT.
                                      </div>
                                    )}

                                    {/* Needs IT Approval */}
                                    {needsApproval && (() => {
                                      const mode = moverApproverConfig.mode || 'same_as_joiner'
                                      const effMode = mode === 'same_as_joiner' ? (moverApproverConfig.joiner_approver_mode || 'nominated') : mode
                                      let approver = ''
                                      if (effMode === 'nominated') {
                                        approver = mode === 'same_as_joiner'
                                          ? (moverApproverConfig.joiner_approver_name || moverApproverConfig.joiner_approver_email || '')
                                          : (moverApproverConfig.name || moverApproverConfig.email || '')
                                      } else if (effMode === 'manager') {
                                        approver = 'employee\'s line manager'
                                      }
                                      return (
                                        <div style={{ padding: '8px 12px', background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 6, marginBottom: 8 }}>
                                          <strong style={{ color: '#1565c0' }}>Needs IT Approval</strong>
                                          <div style={{ fontSize: 12, marginTop: 2 }}>This change needs approval before it can be scheduled.{approver ? ` Approver: ${approver}` : ''}</div>
                                        </div>
                                      )
                                    })()}

                                    {/* Warnings */}
                                    {warnings.map((w: any, i: number) => (
                                      <div key={i} style={{ padding: '6px 10px', background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 6, marginBottom: 6, fontSize: 12 }}>
                                        {typeof w === 'string' ? w : w?.message || w?.description || JSON.stringify(w)}
                                      </div>
                                    ))}

                                    {r.deviceWarning && (
                                      <div style={{ padding: '6px 10px', background: '#fff3e0', border: '1px solid #ff9800', borderRadius: 6, marginBottom: 6, fontSize: 12 }}>
                                        {String(r.deviceWarning)}
                                      </div>
                                    )}

                                    {/* Technical details — collapsible */}
                                    <details style={{ marginTop: 8 }}>
                                      <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>Technical details</summary>
                                      <div style={{ marginTop: 6, fontSize: 11, color: '#555', background: '#fff', padding: 8, borderRadius: 6 }}>
                                        {r.automaticSteps && (
                                          <div style={{ marginBottom: 4 }}>
                                            <strong>Automatic steps:</strong>
                                            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                                              {(Array.isArray(r.automaticSteps) ? r.automaticSteps : []).map((s: any, i: number) => (
                                                <li key={i}>{typeof s === 'string' ? s : s?.description || JSON.stringify(s)}</li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {r.instructions && (
                                          <div style={{ marginBottom: 4 }}>
                                            <strong>Instructions:</strong>
                                            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                                              {(Array.isArray(r.instructions) ? r.instructions : []).map((s: any, i: number) => (
                                                <li key={i}>{typeof s === 'string' ? s : s?.description || JSON.stringify(s)}</li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {Array.isArray(r.documents) && r.documents.length > 0 && (
                                          <div style={{ marginBottom: 4 }}><strong>Documents:</strong> {r.documents.map((d: any) => d?.name || String(d)).join(', ')}</div>
                                        )}
                                        <pre style={{ marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(r, null, 2)}</pre>
                                      </div>
                                    </details>
                                  </div>
                                )
                              } catch (e: any) {
                                return (
                                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, fontSize: 12, marginBottom: 10 }}>
                                    <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13, color: '#dc2626' }}>Error displaying check result</div>
                                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#555' }}>{e?.message || String(e)}</pre>
                                  </div>
                                )
                              }
                            })()}

                            {/* Persona schedule status — HR-friendly display */}
                            {personaStatus && (() => {
                              const display = PERSONA_STATUS_DISPLAY[personaStatus] || { label: personaStatus, color: '#616161', bg: '#f5f5f5', border: '#e0e0e0' }
                              const preCheck = m365?.persona_pre_check
                              const preCheckCode = preCheck?.code
                              const help = preCheckCode ? PRECHECK_HELP[preCheckCode] : null
                              const nextActions = m365?.persona_next_actions || []
                              const isActionRequired = ['blocked', 'missed', 'failed'].includes(personaStatus)

                              return (
                                <div style={{ padding: '12px 16px', background: display.bg, border: `1px solid ${display.border}`, borderRadius: 8, marginBottom: 10 }}>
                                  {/* Status badge */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: help || m365?.persona_schedule_message ? 8 : 0 }}>
                                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: display.color, flexShrink: 0, animation: personaStatus === 'running' ? 'pulse 1.5s infinite' : undefined }} />
                                    <strong style={{ color: display.color, fontSize: 13 }}>{display.label}</strong>
                                    {m365?.persona_schedule_next_due_at && !['completed', 'cancelled', 'failed'].includes(personaStatus) && (
                                      <span style={{ fontSize: 11, color: '#666', marginLeft: 'auto' }}>
                                        Next scheduled: {new Date(m365.persona_schedule_next_due_at).toLocaleDateString('en-GB')}
                                      </span>
                                    )}
                                  </div>

                                  {/* What happened — engine message */}
                                  {m365?.persona_schedule_message && (
                                    <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>{m365.persona_schedule_message}</div>
                                  )}

                                  {/* What to do — preCheck help for HR */}
                                  {help && (
                                    <div style={{ padding: '10px 12px', background: '#fff', border: `1px solid ${display.border}`, borderRadius: 6, marginBottom: 8 }}>
                                      <div style={{ fontWeight: 600, fontSize: 13, color: display.color, marginBottom: 4 }}>{help.summary}</div>
                                      <div style={{ fontSize: 12, color: '#333' }}>{help.action}</div>
                                    </div>
                                  )}

                                  {/* Action buttons */}
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {(nextActions.includes('recheck') || (isActionRequired && nextActions.length === 0)) && (
                                      <button className="admin-btn-sm admin-btn-save" style={{ fontSize: 12 }}
                                        onClick={async () => {
                                          const result = await callIfoMover('recheck-persona-schedule', { schedule_id: m365?.persona_schedule_id, role_change_id: rc.id })
                                          if (result) {
                                            await loadMovers()
                                            showSuccess('Persona schedule rechecked')
                                          }
                                        }}>
                                        Try Again
                                      </button>
                                    )}
                                    {nextActions.includes('cancel') && (
                                      <button className="admin-btn-sm" style={{ fontSize: 12, background: '#f5f5f5', border: '1px solid #ccc', color: '#333' }}
                                        onClick={async () => {
                                          if (!confirm('Cancel this persona change schedule?')) return
                                          await callIfoMover('cancel-persona-schedule', { schedule_id: m365?.persona_schedule_id, role_change_id: rc.id, reason: 'Cancelled by HR' })
                                          await loadMovers()
                                        }}>
                                        Cancel
                                      </button>
                                    )}
                                  </div>

                                  {/* Technical details — hidden by default */}
                                  <details style={{ marginTop: 8 }}>
                                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>Technical details</summary>
                                    <div style={{ marginTop: 6, fontSize: 11, color: '#666', background: '#fff', padding: 8, borderRadius: 6 }}>
                                      {preCheckCode && <div>PreCheck code: <code>{preCheckCode}</code></div>}
                                      {help?.detail && <div style={{ marginTop: 2 }}>{help.detail}</div>}
                                      {m365?.persona_schedule_id && <div style={{ marginTop: 2 }}>Schedule ID: {m365.persona_schedule_id}</div>}
                                      {m365?.persona_schedule_stages && (
                                        <pre style={{ marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>{JSON.stringify(m365.persona_schedule_stages, null, 2)}</pre>
                                      )}
                                    </div>
                                  </details>
                                </div>
                              )
                            })()}

                            {/* Persona function gating */}
                            {(() => { const g = getFunctionGating('personas'); return g.blocked ? (
                              <div style={{ marginBottom: 8, padding: 10, background: '#fff3e0', borderRadius: 8, border: '1px solid #ffe0b2' }}>
                                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#e65100' }}>Persona changes: {g.message}</p>
                                {g.reason && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#bf360c' }}>{g.reason}</p>}
                              </div>
                            ) : null })()}
                            {/* Action buttons */}
                            {!personaStatus && !personaCheckResult && !getFunctionGating('personas').blocked && (
                              <button className="admin-btn admin-btn-save" style={{ background: '#7b1fa2' }}
                                onClick={async () => {
                                  const checkResult = await callIfoMover('check-persona', {
                                    persona_id: personaNew,
                                    user_principal_name: rc.employee_email,
                                  })
                                  if (!checkResult) return

                                  if (checkResult.jobId) {
                                    let jobData: any = checkResult
                                    let attempts = 0
                                    while (jobData.status !== 'succeeded' && jobData.status !== 'failed' && attempts < 20) {
                                      await new Promise(r => setTimeout(r, 1500))
                                      jobData = await callIfoMover('get-job', { job_id: checkResult.jobId })
                                      if (!jobData) break
                                      attempts++
                                    }
                                    if (jobData?.result) {
                                      await supabase.from('mover_m365_actions').upsert({
                                        role_change_id: rc.id,
                                        company_id: selectedCompanyId,
                                        persona_check_result: jobData.result,
                                        employee_upn: rc.employee_email,
                                        updated_at: new Date().toISOString(),
                                      }, { onConflict: 'role_change_id' })
                                      await loadMovers()
                                      showSuccess('Persona check complete — review the results below')
                                      return
                                    }
                                  }

                                  await supabase.from('mover_m365_actions').upsert({
                                    role_change_id: rc.id,
                                    company_id: selectedCompanyId,
                                    persona_check_result: checkResult,
                                    employee_upn: rc.employee_email,
                                    updated_at: new Date().toISOString(),
                                  }, { onConflict: 'role_change_id' })
                                  await loadMovers()
                                  showSuccess('Persona check complete — review the results below')
                                }}>
                                Check Persona Change
                              </button>
                            )}

                            {personaCheckResult && !personaStatus && (
                              <button className="admin-btn admin-btn-save" style={{ background: '#7b1fa2' }}
                                onClick={async () => {
                                  let approverEmail = ''
                                  let approverName = ''
                                  const mode = moverApproverConfig.mode || 'same_as_joiner'
                                  const effectiveMode = mode === 'same_as_joiner' ? (moverApproverConfig.joiner_approver_mode || 'nominated') : mode
                                  if (effectiveMode === 'nominated') {
                                    if (mode === 'same_as_joiner') {
                                      approverEmail = moverApproverConfig.joiner_approver_email || ''
                                      approverName = moverApproverConfig.joiner_approver_name || ''
                                    } else {
                                      approverEmail = moverApproverConfig.email || ''
                                      approverName = moverApproverConfig.name || ''
                                    }
                                  } else if (effectiveMode === 'manager') {
                                    const { data: empRec } = await supabase.from('employees').select('manager_name, manager_email').eq('id', rc.employee_id).eq('company_id', selectedCompanyId).maybeSingle()
                                    approverEmail = empRec?.manager_email || ''
                                    approverName = empRec?.manager_name || ''
                                  }
                                  if (!approverEmail) {
                                    showError('No approver email configured. Check the Mover Approver setting in Integrations.')
                                    return
                                  }

                                  const oldName = enginePersonas.find(ep => ep.id === resolvePersonaId(personaOld))?.name || resolvePersonaId(personaOld)
                                  const newName = enginePersonas.find(ep => ep.id === resolvePersonaId(personaNew))?.name || resolvePersonaId(personaNew)
                                  const taskDesc = `${rc.employee_name} — Persona change: ${oldName} → ${newName}\nM365 account: ${rc.employee_email}`

                                  const { data: existingWt } = await supabase.from('workflow_tracker')
                                    .select('id, status').eq('onboard_id', rc.id).eq('record_type', 'M365 Mover Persona').eq('status', 'Pending').maybeSingle()
                                  if (existingWt) {
                                    showError('An approval request is already pending for this persona change.')
                                    return
                                  }

                                  const { error: wtErr } = await supabase.from('workflow_tracker').insert({
                                    company_id: selectedCompanyId,
                                    record_type: 'M365 Mover Persona',
                                    onboard_id: rc.id,
                                    emp_display_name: rc.employee_name,
                                    action: 'Approve',
                                    employee_email: approverEmail,
                                    assigned_to: approverEmail,
                                    status: 'Pending',
                                    approval_status: 'pending',
                                    task_description: taskDesc,
                                  })
                                  if (wtErr) {
                                    showError(`Failed to create approval task: ${wtErr.message}`)
                                    return
                                  }

                                  const { data: approverEmp } = await supabase.from('employees')
                                    .select('id').eq('company_id', selectedCompanyId).or(`user_email.eq.${approverEmail},email.eq.${approverEmail}`).maybeSingle()
                                  if (approverEmp) {
                                    await supabase.from('notifications').insert({
                                      company_id: selectedCompanyId,
                                      employee_id: approverEmp.id,
                                      type: 'action',
                                      notification_type: 'm365_mover_persona_approval',
                                      title: 'M365 Persona Change Approval',
                                      message: `${rc.employee_name}'s persona change (${oldName} → ${newName}) needs your approval.`,
                                      send_email: true,
                                    })
                                  }

                                  await supabase.from('mover_m365_actions').upsert({
                                    role_change_id: rc.id,
                                    company_id: selectedCompanyId,
                                    persona_schedule_status: 'pending_approval',
                                    employee_upn: rc.employee_email,
                                    updated_at: new Date().toISOString(),
                                  }, { onConflict: 'role_change_id' })

                                  await loadMovers()
                                  showSuccess(`Persona change approval sent to ${approverName || approverEmail}`)
                                }}>
                                {personaCheckResult?.approvalRequired ? 'Request Approval' : 'Schedule Persona Change'}
                              </button>
                            )}
                          </div>
                        )
                      })()}

                      {/* Verification panel — show when both mover and persona are done */}
                      {(m365?.run_status === 'completed' || !(rc.changes?.job_title || rc.changes?.department || rc.changes?.location || rc.changes?.manager_name || rc.changes?.manager_email)) &&
                       (m365?.persona_schedule_status === 'scheduled' || m365?.persona_schedule_status === 'completed' || !(rc.changes?.persona?.old && rc.changes?.persona?.new && rc.changes.persona.old !== rc.changes.persona.new)) && (
                        <div style={{ padding: '12px 16px', background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: '#2e7d32' }}>Changes applied</div>
                          <p style={{ fontSize: 12, color: '#333', margin: '0 0 8px' }}>The M365 account changes have been applied. Ask IT to verify if needed.</p>
                          <details>
                            <summary style={{ cursor: 'pointer', fontSize: 11, color: '#888' }}>Verification steps for IT</summary>
                            <ul style={{ fontSize: 11, margin: '6px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, color: '#555' }}>
                              <li><strong>Entra ID</strong> — Check the user's profile, extensionAttribute1 value, and dynamic group memberships.</li>
                              <li><strong>Intune</strong> — Verify the correct configuration profiles and compliance policies are assigned to the user's devices.</li>
                              <li><strong>Conditional Access</strong> — Check sign-in logs to confirm the correct policies are being applied.</li>
                            </ul>
                          </details>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: '12px 16px', background: '#f5f5f5', borderRadius: 8, fontSize: 13 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!moverChecks['update_accounts']} onChange={e => setMoverChecks({ ...moverChecks, update_accounts: e.target.checked })} />
                        I have manually updated the employee's M365 account
                      </label>
                    </div>
                  )}
                </div>
                )
                } catch (err: any) {
                  console.error('Mover step 2 render error:', err)
                  return <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 13 }}>
                    <strong>Error rendering step 2:</strong> {err?.message || String(err)}
                    <pre style={{ fontSize: 11, marginTop: 8, whiteSpace: 'pre-wrap' }}>{err?.stack}</pre>
                  </div>
                }
              })()}

              {currentStep.key === 'update_records' && (
                <div>
                  <p style={{ fontSize: 13, marginBottom: 12 }}>Save the following changes to the employee's InflowHR record:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                    {Object.entries(rc.changes || {}).map(([field, val]: [string, any]) => (
                      <div key={field} style={{ fontSize: 13 }}>
                        <strong>{field.replace(/_/g, ' ')}:</strong> {val?.old || '—'} → <span style={{ color: '#2e7d32', fontWeight: 600 }}>{val?.new || '—'}</span>
                      </div>
                    ))}
                  </div>
                  <button className="admin-btn admin-btn-save" style={{ background: '#e65100' }}
                    onClick={async () => {
                      const updates: Record<string, any> = {}
                      const ch = rc.changes || {}
                      if (ch.job_title?.new) updates.job_title = ch.job_title.new
                      if (ch.department?.new) updates.department = ch.department.new
                      if (ch.location?.new) updates.location = ch.location.new
                      if (ch.manager_name?.new) updates.manager_name = ch.manager_name.new
                      if (ch.manager_email?.new) updates.manager_email = ch.manager_email.new
                      if (ch.persona?.new) updates.persona = ch.persona.new
                      if (Object.keys(updates).length > 0) {
                        const { error } = await supabase.from('employees').update(updates).eq('id', rc.employee_id)
                        if (error) { showError(error.message); return }
                      }
                      setMoverChecks({ ...moverChecks, update_records: true })
                      showSuccess('HR record updated')
                    }}>
                    Save Changes to InflowHR
                  </button>
                </div>
              )}

              {currentStep.key === 'notify_team' && (
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={!!moverChecks['notify_team']} onChange={e => setMoverChecks({ ...moverChecks, notify_team: e.target.checked })} />
                    Team and manager(s) have been notified of the role change
                  </label>
                </div>
              )}

              {currentStep.key === 'review_access' && (
                <div>
                  <p style={{ fontSize: 13, marginBottom: 12 }}>Review any access items requiring manual attention:</p>
                  {['SharePoint sites and document libraries', 'Teams channels and groups', 'Shared drives and folders', 'Application-specific permissions', 'Physical access (badges, keys)'].map((item, i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 6 }}>
                      <input type="checkbox" />
                      {item}
                    </label>
                  ))}
                </div>
              )}

              {currentStep.key === 'confirm_complete' && (
                <div>
                  <p style={{ fontSize: 13, marginBottom: 12 }}>Confirm all changes have been applied and verified:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
                    {steps.filter(s => s.key !== 'confirm_complete').map(s => (
                      <div key={s.key} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{moverChecks[s.key] ? '✅' : moverSkips[s.key] ? '⏭️' : '⬜'}</span>
                        <span style={{ color: moverChecks[s.key] ? '#16a34a' : moverSkips[s.key] ? '#999' : '#333' }}>{s.label}</span>
                      </div>
                    ))}
                  </div>
                  <button className="admin-btn admin-btn-save" style={{ background: '#16a34a' }}
                    onClick={async () => {
                      await supabase.from('role_changes').update({
                        status: 'completed', is_complete: true, completed_at: new Date().toISOString(),
                        workflow_steps: moverChecks, skipped_steps: moverSkips,
                      }).eq('id', rc.id)
                      await loadMovers()
                      setTab('movers')
                      showSuccess('Role change completed')
                    }}>
                    Mark Complete
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 24, borderTop: '1px solid #e0e0e0', paddingTop: 16 }}>
                {!moverChecks[currentStep.key] && !moverSkips[currentStep.key] && currentStep.key !== 'confirm_complete' && (
                  <>
                    <button className="admin-btn admin-btn-save" style={{ background: '#e65100' }}
                      onClick={async () => {
                        const newChecks = { ...moverChecks, [currentStep.key]: true }
                        setMoverChecks(newChecks)
                        await supabase.from('role_changes').update({ workflow_steps: newChecks, status: 'in_progress' }).eq('id', rc.id)
                        if (moverStep < steps.length - 1) setMoverStep(moverStep + 1)
                      }}>
                      Mark Done & Next
                    </button>
                    <button className="admin-btn-sm" style={{ color: '#888' }}
                      onClick={async () => {
                        const newSkips = { ...moverSkips, [currentStep.key]: true }
                        setMoverSkips(newSkips)
                        await supabase.from('role_changes').update({ skipped_steps: newSkips, status: 'in_progress' }).eq('id', rc.id)
                        if (moverStep < steps.length - 1) setMoverStep(moverStep + 1)
                      }}>
                      Skip
                    </button>
                  </>
                )}
                <button className="admin-btn-sm" disabled={moverStep <= 0} onClick={() => setMoverStep(moverStep - 1)}>← Previous</button>
                <button className="admin-btn-sm" disabled={moverStep >= steps.length - 1} onClick={() => setMoverStep(moverStep + 1)}>Next →</button>
                {(rc.status === 'pending' || rc.status === 'in_progress') && (
                  <button className="admin-btn-sm" style={{ marginLeft: 'auto', color: '#c62828', border: '1px solid #c62828' }} onClick={() => cancelMoverRoleChange(rc)}>Cancel Role Change</button>
                )}
                <button className="admin-btn-sm" style={{ marginLeft: (rc.status === 'pending' || rc.status === 'in_progress') ? 8 : 'auto', color: '#9e9e9e', border: '1px solid #ccc' }} onClick={() => deleteMoverRoleChange(rc)}>Delete</button>
              </div>
            </div>
          </div>
          </div>
        )
        } catch (wfErr: any) {
          console.error('Mover workflow render error:', wfErr)
          return (
            <div style={{ padding: 24, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#dc2626' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700 }}>Mover Workflow Error</h3>
              <p style={{ margin: '0 0 12px', fontSize: 13 }}>An error occurred rendering the mover workflow. This usually means unexpected data in the role change record.</p>
              <div style={{ background: '#fff', borderRadius: 8, padding: 12, fontSize: 12, fontFamily: 'monospace' }}>
                <div><strong>Error:</strong> {wfErr?.message || String(wfErr)}</div>
                <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 11, color: '#666' }}>{wfErr?.stack}</pre>
              </div>
              <button className="admin-btn-sm" style={{ marginTop: 12 }} onClick={() => { setTab('movers') }}>← Back to Movers List</button>
            </div>
          )
        }
      })()}

      {tab === 'settings' && (
        <div style={{ background: 'var(--admin-card-bg, #fff)', borderRadius: 12, padding: 24, border: '1px solid var(--admin-border, #e0e0e0)' }}>
          {/* Settings sub-tabs */}
          <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--admin-border, #e0e0e0)', marginBottom: 20 }}>
            <button onClick={() => setSettingsSubTab('workflows')}
              style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: settingsSubTab === 'workflows' ? 'var(--admin-accent, #1976d2)' : 'transparent', color: settingsSubTab === 'workflows' ? '#fff' : 'inherit' }}>
              Workflow Steps
            </button>
            <button onClick={() => { setSettingsSubTab('contacts'); setEditingContacts(companyContacts.length > 0 ? companyContacts.map(c => ({ ...c })) : DEFAULT_CONTACTS.map(c => ({ ...c }))); setContactsDirty(false) }}
              style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: settingsSubTab === 'contacts' ? 'var(--admin-accent, #1976d2)' : 'transparent', color: settingsSubTab === 'contacts' ? '#fff' : 'inherit' }}>
              Company Contacts
            </button>
            <button onClick={() => setSettingsSubTab('guide')}
              style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: settingsSubTab === 'guide' ? 'var(--admin-accent, #1976d2)' : 'transparent', color: settingsSubTab === 'guide' ? '#fff' : 'inherit' }}>
              Task Types Guide
            </button>
          </div>

          {/* ── Task Types Guide sub-tab ── */}
          {settingsSubTab === 'guide' && (
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Task Type Taxonomy</h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: '#888' }}>Each workflow step gets a typed category that determines its behaviour, icon, colour coding and available configuration options. Companies can assign any type to custom steps.</p>

              {/* Task type cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
                {Object.entries(STEP_TYPE_META).filter(([k]) => !['action', 'notice'].includes(k)).map(([key, meta]) => {
                  const examples: Record<string, string> = {
                    hr_action: 'Add employee details, Update records, Review access',
                    email: 'Inform starter, Notify manager, Send leaving confirmation',
                    app_notification: 'Notify manager of new starter, Alert IT of account removal',
                    meeting: 'Day 1 welcome meeting, Exit interview, Role change review',
                    elearning: 'Assign compliance training, Health & safety course, GDPR awareness',
                    approval: 'Approve resignation, Confirm final pay, Approve role change',
                    it_provisioning: 'Set up accounts, Request equipment, Remove access, Recover laptop',
                    checklist: 'Export employee data, Review handover notes, Confirm complete',
                  }
                  return (
                    <div key={key} style={{ border: '1px solid var(--admin-border, #e5e7eb)', borderRadius: 10, padding: 16, borderLeft: `4px solid ${meta.color}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 20 }}>{meta.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: meta.color }}>{meta.label}</span>
                      </div>
                      <p style={{ margin: '0 0 10px', fontSize: 12, color: '#555', lineHeight: 1.5 }}>{meta.desc}</p>
                      <p style={{ margin: 0, fontSize: 11, color: '#999', fontStyle: 'italic' }}>e.g. {examples[key]}</p>
                    </div>
                  )
                })}
              </div>

              {/* Step Mapping Tables */}
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Default Step Mapping</h3>

              {/* Onboarding */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Onboarding</h4>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 }}>{WORKFLOW_STEPS.length} steps</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--admin-border, #e5e7eb)' }}>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Step Key</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Label</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Recommended Type</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Config Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {WORKFLOW_STEPS.map((s, i) => {
                        const tm = STEP_TYPE_META[s.step_type || 'checklist']
                        const notes: Record<string, string> = {
                          details: 'Assignee: HR Admin. Phase: Preparation',
                          equipment: 'Assignee: IT contact. Due: start date minus 5 days',
                          meeting: 'Attendees: starter + manager. Duration: 30 min. Date: start date',
                          notify_manager: 'Target: manager. Auto-complete on delivery',
                          plan_day1: 'Assignee: manager. Due: start date minus 3 days',
                          inform_starter: 'To: starter. Template: welcome email. Due: start date minus 7 days',
                          assign_elearning: 'Assignee: starter. Courses configurable. Due: start date + 7 days',
                          accounts: 'Assignee: IT contact. Can trigger InflowOnboarder. Due: start date minus 1 day',
                          day1_access: 'Assignee: IT contact. Depends on: accounts. Due: start date',
                        }
                        return (
                          <tr key={s.key} style={{ borderBottom: '1px solid var(--admin-border, #f0f0f0)', background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>{s.key}</td>
                            <td style={{ padding: '8px 12px' }}>{s.label}</td>
                            <td style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: tm?.bg, color: tm?.color, fontWeight: 600, fontSize: 11 }}>● {tm?.label}</span></td>
                            <td style={{ padding: '8px 12px', color: '#666', fontSize: 11 }}>{notes[s.key] || ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Offboarding */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Offboarding</h4>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#fce7f3', color: '#be185d', fontWeight: 600 }}>{OFFBOARD_STEPS.length} steps</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--admin-border, #e5e7eb)' }}>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Step Key</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Label</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Recommended Type</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Config Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {OFFBOARD_STEPS.map((s, i) => {
                        const tm = STEP_TYPE_META[s.step_type || 'checklist']
                        const notes: Record<string, string> = {
                          approve_resignation: 'Approver: HR Admin. Blocks all subsequent steps',
                          recover_equipment: 'Assignee: IT contact. Due: leave date minus 1 day',
                          leaving_meeting: 'Attendees: leaver + HR. Duration: 45 min. Due: leave date minus 5 days',
                          convert_shared_mailbox: 'Assignee: IT contact. Due: leave date',
                          forward_to_manager: 'Assignee: IT contact. Due: leave date',
                          remove_accounts: 'Assignee: IT contact. Can trigger InflowOnboarder. Due: leave date',
                          review_shifts: 'Assignee: HR Admin. Due: leave date minus 7 days',
                          review_bookings: 'Assignee: HR Admin. Due: leave date minus 7 days',
                          review_benefits: 'Assignee: HR Admin. Due: leave date minus 5 days',
                          review_assets: 'Assignee: HR Admin. Due: leave date minus 3 days',
                          export_data: 'Assignee: HR Admin. GDPR data export pack',
                          reassign_reports: 'Assignee: HR Admin. Transfers pending approvals to new manager',
                          confirm_payments: 'Approver: HR Admin. Final salary, holiday pay, P45',
                        }
                        return (
                          <tr key={s.key} style={{ borderBottom: '1px solid var(--admin-border, #f0f0f0)', background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>{s.key}</td>
                            <td style={{ padding: '8px 12px' }}>{s.label}</td>
                            <td style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: tm?.bg, color: tm?.color, fontWeight: 600, fontSize: 11 }}>● {tm?.label}</span></td>
                            <td style={{ padding: '8px 12px', color: '#666', fontSize: 11 }}>{notes[s.key] || ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Movers */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Movers</h4>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#d1fae5', color: '#059669', fontWeight: 600 }}>{MOVER_STEPS.length} steps</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--admin-border, #e5e7eb)' }}>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Step Key</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Label</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Recommended Type</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px', color: '#888' }}>Config Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MOVER_STEPS.map((s, i) => {
                        const tm = STEP_TYPE_META[s.step_type || 'checklist']
                        const notes: Record<string, string> = {
                          review_changes: 'Approver: HR Admin. Review persona, role, department changes',
                          update_accounts: 'Assignee: IT contact. Updates Entra ID, licences, groups',
                          update_records: 'Assignee: HR Admin. Saves changes to InflowHR record',
                          notify_team: 'Target: new + previous managers. Auto-complete on delivery',
                          review_access: 'Assignee: manager. SharePoint, Teams, shared drives',
                          confirm_complete: 'Assignee: HR Admin. Final verification tick-off',
                        }
                        return (
                          <tr key={s.key} style={{ borderBottom: '1px solid var(--admin-border, #f0f0f0)', background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>{s.key}</td>
                            <td style={{ padding: '8px 12px' }}>{s.label}</td>
                            <td style={{ padding: '8px 12px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: tm?.bg, color: tm?.color, fontWeight: 600, fontSize: 11 }}>● {tm?.label}</span></td>
                            <td style={{ padding: '8px 12px', color: '#666', fontSize: 11 }}>{notes[s.key] || ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Company Contacts sub-tab ── */}
          {settingsSubTab === 'contacts' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Company Contact Points</h3>
                  <p style={{ margin: 0, fontSize: 13, color: '#888' }}>Define key contact points (IT Admin, Support, Facilities, etc.) that workflow steps can send notifications to.</p>
                </div>
                <button className="admin-btn-sm admin-btn-save" disabled={!contactsDirty || contactsSaving} onClick={saveCompanyContacts}
                  style={{ minWidth: 100, opacity: contactsDirty ? 1 : 0.5 }}>
                  {contactsSaving ? 'Saving...' : 'Save Contacts'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {editingContacts.map((c, ci) => (
                  <div key={c.contact_key + ci} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 14, border: '1px solid var(--admin-border, #e5e7eb)', borderRadius: 10, borderLeft: '4px solid #4f46e5' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input className="admin-input" value={c.label} placeholder="Contact name (e.g. IT Admin)"
                          onChange={e => { const u = [...editingContacts]; u[ci] = { ...u[ci], label: e.target.value }; setEditingContacts(u); setContactsDirty(true) }}
                          style={{ flex: 1, minWidth: 140, fontWeight: 600, fontSize: 14 }} />
                        <input className="admin-input" value={c.email} placeholder="Email address"
                          onChange={e => { const u = [...editingContacts]; u[ci] = { ...u[ci], email: e.target.value }; setEditingContacts(u); setContactsDirty(true) }}
                          style={{ flex: 1, minWidth: 200, fontSize: 13 }} type="email" />
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input className="admin-input" value={c.phone || ''} placeholder="Phone (optional)"
                          onChange={e => { const u = [...editingContacts]; u[ci] = { ...u[ci], phone: e.target.value }; setEditingContacts(u); setContactsDirty(true) }}
                          style={{ flex: 1, minWidth: 140, fontSize: 13 }} />
                        <input className="admin-input" value={c.notes || ''} placeholder="Notes (optional)"
                          onChange={e => { const u = [...editingContacts]; u[ci] = { ...u[ci], notes: e.target.value }; setEditingContacts(u); setContactsDirty(true) }}
                          style={{ flex: 2, minWidth: 200, fontSize: 13 }} />
                      </div>
                    </div>
                    <button onClick={() => { setEditingContacts(editingContacts.filter((_, idx) => idx !== ci)); setContactsDirty(true) }}
                      style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#dc2626', flexShrink: 0 }}>✕</button>
                  </div>
                ))}
                <button onClick={() => {
                  const key = `custom_${Date.now()}`
                  setEditingContacts([...editingContacts, { contact_key: key, label: '', email: '', sort_order: editingContacts.length }])
                  setContactsDirty(true)
                }} style={{ background: 'none', border: '2px dashed #c7d2fe', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: '#4f46e5', fontSize: 13, fontWeight: 600, alignSelf: 'flex-start' }}>
                  + Add Contact
                </button>
              </div>
            </div>
          )}

          {/* ── Workflows sub-tab ── */}
          {settingsSubTab === 'workflows' && (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--admin-border, #e0e0e0)' }}>
              <button
                onClick={() => { setSettingsWorkflowType('onboarding'); initEditingSteps() }}
                style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: settingsWorkflowType === 'onboarding' ? 'var(--admin-accent, #1976d2)' : 'transparent', color: settingsWorkflowType === 'onboarding' ? '#fff' : 'inherit' }}
              >Onboarding Steps</button>
              <button
                onClick={() => {
                  setSettingsWorkflowType('offboarding')
                  const defaults = OFFBOARD_STEPS.map((s, i) => ({ step_key: s.key, label: s.label, icon: s.icon, description: s.description, sort_order: i, is_default: true, step_config: { step_type: s.step_type } as StepConfig }))
                  setOffboardEditingSteps(hasOffboardCustomSteps ? offboardCustomSteps : defaults)
                  setSettingsDirty(false)
                }}
                style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: settingsWorkflowType === 'offboarding' ? 'var(--admin-accent, #1976d2)' : 'transparent', color: settingsWorkflowType === 'offboarding' ? '#fff' : 'inherit' }}
              >Offboarding Steps</button>
            </div>
            <button
              className="admin-btn-sm admin-btn-save"
              disabled={!settingsDirty || settingsSaving}
              onClick={settingsWorkflowType === 'onboarding' ? saveCustomSteps : saveOffboardCustomSteps}
              style={{ minWidth: 100, opacity: settingsDirty ? 1 : 0.5 }}
            >
              {settingsSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>{settingsWorkflowType === 'onboarding' ? 'Onboarding' : 'Offboarding'} Workflow Steps</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
              {settingsWorkflowType === 'onboarding'
                ? 'Customise the onboarding workflow for your company. Drag steps to reorder, edit titles and descriptions, or add new steps. Configure notifications and meeting invites per step.'
                : 'Customise the offboarding workflow. Add company-specific steps alongside the defaults. Configure notifications per step.'}
            </p>
          </div>

          {(() => {
            const steps = settingsWorkflowType === 'onboarding' ? editingSteps : offboardEditingSteps
            const setSteps = settingsWorkflowType === 'onboarding'
              ? (u: CustomStep[]) => { setEditingSteps(u); setSettingsDirty(true) }
              : (u: CustomStep[]) => { setOffboardEditingSteps(u); setSettingsDirty(true) }
            const allStepKeys = steps.map(s => ({ key: s.step_key, label: s.label, phase: s.step_config?.phase }))
            return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            {steps.map((step, i) => {
              const cfg = step.step_config || {}
              const updateCfg = (patch: Partial<StepConfig>) => {
                const updated = [...steps]
                updated[i] = { ...updated[i], step_config: { ...cfg, ...patch } }
                setSteps(updated)
              }
              return (
              <div key={step.step_key + '-' + i}>
                {i === 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                    <button
                      onClick={() => {
                        const key = `custom_${Date.now()}`
                        const newStep: CustomStep = { step_key: key, label: 'New Step', icon: '📋', description: 'Describe this step...', sort_order: 0, is_default: false }
                        setSteps([newStep, ...steps])
                        setEditingIdx(0)
                      }}
                      style={{ background: 'none', border: '2px dashed #c7d2fe', borderRadius: 8, padding: '4px 16px', cursor: 'pointer', color: '#4f46e5', fontSize: 18, lineHeight: 1, fontWeight: 700 }}
                      title="Add step before"
                    >+</button>
                  </div>
                )}

                <div
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={e => { e.preventDefault() }}
                  onDrop={() => {
                    if (dragIdx === null || dragIdx === i) return
                    const updated = [...steps]
                    const [moved] = updated.splice(dragIdx, 1)
                    updated.splice(i, 0, moved)
                    setSteps(updated)
                    setDragIdx(null)
                  }}
                  onDragEnd={() => setDragIdx(null)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14, padding: 16,
                    background: dragIdx === i ? '#eef2ff' : 'var(--admin-card-bg, #fff)',
                    border: '1px solid var(--admin-border, #e5e7eb)', borderRadius: 10,
                    cursor: 'grab', transition: 'background 0.15s',
                    borderLeft: `4px solid ${step.is_default ? '#4f46e5' : '#10b981'}`,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 2, color: '#bbb', fontSize: 16, userSelect: 'none' }}>
                    <span>⠿</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#aaa', width: 22, height: 22, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  </div>

                  <div style={{ fontSize: 24, lineHeight: 1, paddingTop: 2 }}>{step.icon}</div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingIdx === i ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            className="admin-input"
                            value={step.icon}
                            onChange={e => {
                              const updated = [...steps]
                              updated[i] = { ...updated[i], icon: e.target.value }
                              setSteps(updated)
                            }}
                            style={{ width: 50, textAlign: 'center', fontSize: 18, padding: '4px 6px' }}
                            placeholder="📋"
                          />
                          <input
                            className="admin-input"
                            value={step.label}
                            onChange={e => {
                              const updated = [...steps]
                              updated[i] = { ...updated[i], label: e.target.value }
                              setSteps(updated)
                            }}
                            style={{ flex: 1, fontWeight: 700, fontSize: 14 }}
                            placeholder="Step title"
                          />
                        </div>
                        <textarea
                          className="admin-input"
                          value={step.description}
                          onChange={e => {
                            const updated = [...steps]
                            updated[i] = { ...updated[i], description: e.target.value }
                            setSteps(updated)
                          }}
                          rows={2}
                          style={{ resize: 'vertical', fontSize: 13 }}
                          placeholder="Step description"
                        />

                        {/* ── Phase selector ── */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                          <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Phase:</label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                            <input type="radio" name={`phase_${i}`} checked={cfg.phase !== 'post_join'} onChange={() => updateCfg({ phase: 'preparation' })} /> Preparation
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                            <input type="radio" name={`phase_${i}`} checked={cfg.phase === 'post_join'} onChange={() => updateCfg({ phase: 'post_join' })} /> Post-Join
                          </label>
                          <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>{cfg.phase === 'post_join' ? 'Runs after account is live' : 'Runs before account activation'}</span>
                        </div>

                        {/* ── Notification config ── */}
                        <div style={{ border: '1px solid #e0e7ff', borderRadius: 8, padding: 12, background: '#f8faff' }}>
                          <div style={{ fontWeight: 600, fontSize: 12, color: '#4338ca', marginBottom: 8 }}>Notification Settings</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Task Type:</label>
                            <select className="admin-input" value={cfg.step_type || 'checklist'} onChange={e => updateCfg({ step_type: e.target.value as StepConfig['step_type'] })} style={{ fontSize: 12, maxWidth: 200 }}>
                              {Object.entries(STEP_TYPE_META).filter(([k]) => k !== 'action' && k !== 'notice').map(([k, v]) => (
                                <option key={k} value={k}>{v.icon} {v.label}</option>
                              ))}
                            </select>
                            <span style={{ fontSize: 11, color: '#888' }}>{STEP_TYPE_META[cfg.step_type || 'checklist']?.desc}</span>
                          </div>

                          {/* Survey picker — shown when type is survey */}
                          {cfg.step_type === 'survey' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                              <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Survey:</label>
                              <select className="admin-input" value={cfg.survey_id || ''} onChange={e => updateCfg({ survey_id: e.target.value || undefined })} style={{ fontSize: 12, maxWidth: 300 }}>
                                <option value="">— Select a survey —</option>
                                {companySurveys.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
                              </select>
                              {companySurveys.length === 0 && <span style={{ fontSize: 11, color: '#dc2626' }}>No surveys created yet — create one in Surveys &amp; Feedback first</span>}
                            </div>
                          )}

                          {/* Assignee Role */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Assignee:</label>
                            <select className="admin-input" value={cfg.assignee_role || ''} onChange={e => updateCfg({ assignee_role: (e.target.value || undefined) as StepConfig['assignee_role'] })} style={{ fontSize: 12, maxWidth: 200 }}>
                              <option value="">— Not set —</option>
                              <option value="hr_admin">HR Admin</option>
                              <option value="line_manager">Line Manager</option>
                              <option value="it_contact">IT Contact</option>
                              <option value="starter_leaver">Starter / Leaver</option>
                              <option value="finance">Finance</option>
                              <option value="custom">Custom (see notification)</option>
                            </select>
                          </div>

                          {/* Relative Due Date */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Due:</label>
                            <select className="admin-input" value={cfg.relative_due_anchor || 'start_date'} onChange={e => updateCfg({ relative_due_anchor: e.target.value as StepConfig['relative_due_anchor'] })} style={{ fontSize: 12, width: 130 }}>
                              <option value="start_date">Start date</option>
                              <option value="leave_date">Leave date</option>
                              <option value="effective_date">Effective date</option>
                            </select>
                            <select className="admin-input" value={cfg.relative_due_days !== undefined ? (cfg.relative_due_days < 0 ? 'minus' : 'plus') : ''} onChange={e => {
                              const dir = e.target.value
                              if (!dir) { updateCfg({ relative_due_days: undefined }); return }
                              const abs = Math.abs(cfg.relative_due_days || 0) || 1
                              updateCfg({ relative_due_days: dir === 'minus' ? -abs : abs })
                            }} style={{ fontSize: 12, width: 90 }}>
                              <option value="">—</option>
                              <option value="minus">minus</option>
                              <option value="plus">plus</option>
                            </select>
                            {cfg.relative_due_days !== undefined && (
                              <input type="number" className="admin-input" value={Math.abs(cfg.relative_due_days)} onChange={e => {
                                const v = parseInt(e.target.value) || 0
                                updateCfg({ relative_due_days: (cfg.relative_due_days || 0) < 0 ? -v : v })
                              }} style={{ fontSize: 12, width: 55 }} min={0} max={90} />
                            )}
                            {cfg.relative_due_days !== undefined && <span style={{ fontSize: 11, color: '#888' }}>days</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 180 }}>
                              <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 }}>Send to</label>
                              <select className="admin-input" value={cfg.notify_starter ? '__starter__' : (cfg.notify_contact_key || '')} onChange={e => {
                                const v = e.target.value
                                if (v === '__starter__') updateCfg({ notify_starter: true, notify_contact_key: undefined, notify_email: undefined })
                                else updateCfg({ notify_starter: undefined, notify_contact_key: v || undefined, notify_email: v ? undefined : cfg.notify_email })
                              }} style={{ fontSize: 12 }}>
                                <option value="">— Custom email —</option>
                                <option value="__starter__">New Starter / Leaver</option>
                                {(companyContacts.length > 0 ? companyContacts : DEFAULT_CONTACTS).map(c => (
                                  <option key={c.contact_key} value={c.contact_key}>{c.label}{c.email ? ` (${c.email})` : ''}</option>
                                ))}
                              </select>
                            </div>
                            {!cfg.notify_contact_key && !cfg.notify_starter && (
                              <div style={{ flex: 1, minWidth: 200 }}>
                                <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 }}>Email address</label>
                                <input className="admin-input" value={cfg.notify_email || ''} onChange={e => updateCfg({ notify_email: e.target.value })} placeholder="recipient@company.com" style={{ fontSize: 12 }} type="email" />
                              </div>
                            )}
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 }}>Subject</label>
                            <input className="admin-input" value={cfg.notify_subject || ''} onChange={e => updateCfg({ notify_subject: e.target.value })} placeholder="{firstname} {surname} — step title" style={{ fontSize: 12, width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 }}>Message body</label>
                            <textarea className="admin-input" value={cfg.notify_body || ''} onChange={e => updateCfg({ notify_body: e.target.value })} rows={2} placeholder="Use {firstname}, {surname}, {start_date}, {manager}, {job_title}, {department}, {leaving_date}" style={{ fontSize: 12, resize: 'vertical', width: '100%' }} />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 }}>Requires step completed first</label>
                            <select className="admin-input" value={cfg.requires_step || ''} onChange={e => updateCfg({ requires_step: e.target.value || undefined })} style={{ fontSize: 12 }}>
                              <option value="">— No dependency —</option>
                              {allStepKeys.filter(s => s.key !== step.step_key && (cfg.phase === 'post_join' ? s.phase === 'post_join' : s.phase !== 'post_join')).map(s => (
                                <option key={s.key} value={s.key}>{s.label}</option>
                              ))}
                            </select>
                          </div>

                          {/* ── Meeting config (for steps like Organise First Meeting) ── */}
                          <div style={{ marginTop: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#555', cursor: 'pointer' }}>
                              <input type="checkbox" checked={!!cfg.meeting} onChange={e => {
                                if (e.target.checked) {
                                  updateCfg({ meeting: { title: 'Welcome Meeting — {firstname} {surname}', body: 'Hi {manager},\n\nPlease schedule a welcome meeting with {firstname} {surname} who is joining on {start_date}.\n\nSuggested agenda:\n- Introduction and team overview\n- First week expectations\n- IT setup and access\n- Questions and next steps\n\nPlease send a calendar invite to {firstname} and yourself.', attendees: ['manager', 'starter'] } })
                                } else {
                                  updateCfg({ meeting: undefined })
                                }
                              }} />
                              Include meeting invite details
                            </label>
                            {cfg.meeting && (
                              <div style={{ marginTop: 8, padding: 10, border: '1px solid #c7d2fe', borderRadius: 6, background: '#eef2ff' }}>
                                <div style={{ marginBottom: 6 }}>
                                  <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 }}>Meeting title</label>
                                  <input className="admin-input" value={cfg.meeting.title || ''} onChange={e => updateCfg({ meeting: { ...cfg.meeting!, title: e.target.value } })} style={{ fontSize: 12, width: '100%' }} />
                                </div>
                                <div style={{ marginBottom: 6 }}>
                                  <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 }}>Duration (minutes)</label>
                                  <input type="number" className="admin-input" value={cfg.meeting?.duration_minutes || 30} onChange={e => updateCfg({ meeting: { ...cfg.meeting!, duration_minutes: parseInt(e.target.value) || 30 } })} style={{ fontSize: 12, width: 80 }} min={15} max={480} step={15} />
                                </div>
                                <div style={{ marginBottom: 6 }}>
                                  <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 }}>Email body template</label>
                                  <textarea className="admin-input" value={cfg.meeting.body || ''} onChange={e => updateCfg({ meeting: { ...cfg.meeting!, body: e.target.value } })} rows={4} style={{ fontSize: 12, resize: 'vertical', width: '100%' }} />
                                </div>
                                <div>
                                  <label style={{ fontSize: 11, fontWeight: 600, color: '#555', display: 'block', marginBottom: 2 }}>Attendees</label>
                                  <div style={{ display: 'flex', gap: 12 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                                      <input type="checkbox" checked={cfg.meeting.attendees?.includes('manager') ?? true} onChange={e => {
                                        const att = cfg.meeting?.attendees || []
                                        updateCfg({ meeting: { ...cfg.meeting!, attendees: e.target.checked ? [...att.filter(a => a !== 'manager'), 'manager'] : att.filter(a => a !== 'manager') } })
                                      }} /> Manager
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                                      <input type="checkbox" checked={cfg.meeting.attendees?.includes('starter') ?? true} onChange={e => {
                                        const att = cfg.meeting?.attendees || []
                                        updateCfg({ meeting: { ...cfg.meeting!, attendees: e.target.checked ? [...att.filter(a => a !== 'starter'), 'starter'] : att.filter(a => a !== 'starter') } })
                                      }} /> New Starter
                                    </label>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: '#888' }}>Placeholders: <code style={{ fontSize: 10 }}>{'{firstname}'} {'{surname}'} {'{start_date}'} {'{manager}'} {'{job_title}'} {'{department}'} {'{leaving_date}'}</code></div>

                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="admin-btn-sm admin-btn-save" onClick={() => setEditingIdx(null)}>Done</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1e1e2d' }}>
                          {step.label}
                          {(() => { const tm = STEP_TYPE_META[cfg.step_type || 'checklist']; return tm ? <span style={{ fontSize: 10, marginLeft: 8, padding: '1px 6px', borderRadius: 4, background: tm.bg, color: tm.color, fontWeight: 600 }}>{tm.label}</span> : null })()}
                          {cfg.meeting && <span style={{ fontSize: 10, marginLeft: 4, padding: '1px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>Meeting</span>}
                          {cfg.step_type === 'survey' && cfg.survey_id && <span style={{ fontSize: 10, marginLeft: 4, padding: '1px 6px', borderRadius: 4, background: '#f0fdfa', color: '#0d9488', fontWeight: 600 }}>📊 {companySurveys.find(s => s.id === cfg.survey_id)?.title || 'Survey'}</span>}
                          {cfg.requires_step && <span style={{ fontSize: 10, marginLeft: 4, padding: '1px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>Requires: {allStepKeys.find(s => s.key === cfg.requires_step)?.label || cfg.requires_step}</span>}
                          {cfg.phase === 'post_join' && <span style={{ fontSize: 10, marginLeft: 4, padding: '1px 6px', borderRadius: 4, background: '#d1fae5', color: '#065f46', fontWeight: 600 }}>Post-Join</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2, lineHeight: 1.4 }}>{step.description}</div>
                        {(cfg.notify_email || cfg.notify_contact_key || cfg.notify_starter) && (
                          <div style={{ fontSize: 11, color: '#6366f1', marginTop: 4 }}>
                            Notifies: {cfg.notify_starter ? 'New Starter / Leaver' : cfg.notify_contact_key ? (companyContacts.find(c => c.contact_key === cfg.notify_contact_key)?.label || cfg.notify_contact_key) : cfg.notify_email}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {editingIdx !== i && (
                      <button
                        onClick={() => setEditingIdx(i)}
                        style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#666' }}
                      >Edit</button>
                    )}
                    <button
                      onClick={() => {
                        if (steps.length <= 1) return
                        const updated = steps.filter((_, idx) => idx !== i)
                        setSteps(updated)
                        if (editingIdx === i) setEditingIdx(null)
                      }}
                      style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#dc2626' }}
                      title="Remove step"
                    >✕</button>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                  <button
                    onClick={() => {
                      const key = `custom_${Date.now()}`
                      const newStep: CustomStep = { step_key: key, label: 'New Step', icon: '📋', description: 'Describe this step...', sort_order: i + 1, is_default: false }
                      const updated = [...steps]
                      updated.splice(i + 1, 0, newStep)
                      setSteps(updated)
                      setEditingIdx(i + 1)
                    }}
                    style={{ background: 'none', border: '2px dashed #c7d2fe', borderRadius: 8, padding: '4px 16px', cursor: 'pointer', color: '#4f46e5', fontSize: 18, lineHeight: 1, fontWeight: 700 }}
                    title="Add step after"
                  >+</button>
                </div>
              </div>
              )
            })}
          </div>
            )
          })()}

          {settingsWorkflowType === 'onboarding' && hasCustomSteps && (
            <div style={{ marginTop: 16, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, color: '#166534' }}>
              Custom workflow active — {customSteps.length} steps configured for this company.
            </div>
          )}
          {settingsWorkflowType === 'onboarding' && !hasCustomSteps && (
            <div style={{ marginTop: 16, padding: 12, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, fontSize: 13, color: '#4338ca' }}>
              Using default workflow ({WORKFLOW_STEPS.length} steps). Click Save Changes to customise for this company.
            </div>
          )}
          {settingsWorkflowType === 'offboarding' && hasOffboardCustomSteps && (
            <div style={{ marginTop: 16, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, color: '#166534' }}>
              Custom offboarding workflow active — {offboardCustomSteps.length} steps configured for this company.
            </div>
          )}
          {settingsWorkflowType === 'offboarding' && !hasOffboardCustomSteps && (
            <div style={{ marginTop: 16, padding: 12, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, fontSize: 13, color: '#4338ca' }}>
              Using default offboarding workflow ({OFFBOARD_STEPS.length} steps). Click Save Changes to customise for this company.
            </div>
          )}
          </>)}
        </div>
      )}

      {tab === 'setup' && (
        <CompanySetupWizard onSetupComplete={(companyId) => { refreshCompanies(companyId); load() }} />
      )}

      {/* TAP reveal confirmation dialog */}
      {tapRevealConfirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onClick={() => setTapRevealConfirmOpen(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#1565c0' }}>View Sign-In Pass</h3>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#333' }}>
              This pass is shown once and then deleted. Make sure you can note it down or hand it over now.
            </p>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: '#c62828', fontWeight: 500 }}>
              You will not be able to view it again.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="admin-btn-sm" onClick={() => setTapRevealConfirmOpen(false)}>Not Now</button>
              <button className="admin-btn-sm admin-btn-save" disabled={tapRevealing}
                style={{ background: '#0078D4' }}
                onClick={() => { if (m365Actions?.pass_id && selectedRecord) tapRevealPass(selectedRecord.id, m365Actions.pass_id) }}>
                {tapRevealing ? 'Loading...' : 'Show It'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAP reveal modal — pass value shown, never cached/stored */}
      {tapRevealData && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 480, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,.25)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#1565c0', display: 'flex', alignItems: 'center', gap: 8 }}>
              🔑 First-Day Sign-In Pass
            </h3>
            <div style={{ background: '#f5f5f5', border: '2px solid #1565c0', borderRadius: 8, padding: 16, marginBottom: 12, textAlign: 'center' }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Temporary Access Pass</p>
              <p style={{ margin: 0, fontSize: 24, fontFamily: 'monospace', fontWeight: 700, color: '#1565c0', userSelect: 'text', wordBreak: 'break-all' }}>
                {tapRevealData.pass}
              </p>
            </div>
            <div style={{ display: 'grid', gap: 6, fontSize: 13, marginBottom: 12 }}>
              <div><strong>Sign-in name:</strong> {tapRevealData.upn}</div>
              <div><strong>Expires:</strong> {tapRevealData.expiresAt ? new Date(tapRevealData.expiresAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown'}</div>
              <div><strong>Usage:</strong> {tapRevealData.oneTimeUse ? 'Works once' : 'Works until expiry'}</div>
            </div>
            {tapRevealData.notice && (
              <div style={{ padding: '8px 12px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, fontSize: 12, color: '#6d4c00', marginBottom: 12 }}>
                {tapRevealData.notice}
              </div>
            )}
            <div style={{ padding: '10px 12px', background: '#e3f2fd', borderRadius: 6, fontSize: 12, color: '#1565c0', marginBottom: 16 }}>
              <strong>Instructions:</strong> Go to <span style={{ fontFamily: 'monospace', userSelect: 'text' }}>aka.ms/mysecurityinfo</span>, sign in with the work email above, choose "Use a Temporary Access Pass", enter it, then set up the Microsoft Authenticator app.
            </div>
            <button className="admin-btn-sm admin-btn-save" style={{ background: '#0078D4', width: '100%' }}
              onClick={() => setTapRevealData(null)}>
              I've Given It to {selectedRecord?.firstname || 'Them'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
