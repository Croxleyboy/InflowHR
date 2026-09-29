import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider } from './context/ToastContext'
import { FeatureProvider } from './context/FeatureContext'
import { LanguageProvider } from './context/LanguageContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useFeatures } from './context/FeatureContext'
import Login from './pages/Login'
import PrivacyNotice from './pages/PrivacyNotice'
import AccessDenied from './pages/AccessDenied'
import InitialSetup from './pages/InitialSetup'
import Footer from './components/Footer'
import DesktopLayout from './components/DesktopLayout'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Expenses from './pages/Expenses'
import NewExpenseClaim from './pages/NewExpenseClaim'
import ExpenseDetail from './pages/ExpenseDetail'
import Notifications from './pages/Notifications'
import ExpenseApproval from './pages/ExpenseApproval'
import LeaveApproval from './pages/LeaveApproval'
import CreateNotification from './pages/CreateNotification'
import MyLeave from './pages/MyLeave'
import MyLeaveHistory from './pages/MyLeaveHistory'
import LeaveDetail from './pages/LeaveDetail'
import LeaveCalendar from './pages/LeaveCalendar'
import NewLeaveRequest from './pages/NewLeaveRequest'
import MyProfile from './pages/MyProfile'
import Directory from './pages/Directory'
import Kudos from './pages/Kudos'
import Payslips from './pages/Payslips'
import Benefits from './pages/Benefits'
import ELearning from './pages/ELearning'
import CourseContent from './pages/CourseContent'
import GettingStartedCourse from './pages/GettingStartedCourse'
import Timesheets from './pages/Timesheets'
import NewTimesheet from './pages/NewTimesheet'
import TimesheetDetail from './pages/TimesheetDetail'
import TimesheetHistory from './pages/TimesheetHistory'
import TimesheetApproval from './pages/TimesheetApproval'
import OneToOnes from './pages/OneToOnes'
import NewOneToOne from './pages/NewOneToOne'
import OneToOneDetail from './pages/OneToOneDetail'
import PerformanceGoals from './pages/PerformanceGoals'
import MyShifts from './pages/MyShifts'
import ShiftSwap from './pages/ShiftSwap'
import Availability from './pages/Availability'
import LegalTimesheets from './pages/LegalTimesheets'
import SpaceBooking from './pages/SpaceBooking'
import Placeholder from './pages/Placeholder'
import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminExpenses from './pages/admin/AdminExpenses'
import AdminLeave from './pages/admin/AdminLeave'
import AdminPayroll from './pages/admin/AdminPayroll'
import AdminEmployees from './pages/admin/AdminEmployees'
import AdminKudos from './pages/admin/AdminKudos'
import AdminELearning from './pages/admin/AdminELearning'
import AdminAnnouncements from './pages/admin/AdminAnnouncements'
import AdminOnboarding from './pages/admin/AdminOnboarding'
import AdminTickets from './pages/admin/AdminTickets'
import AdminBenefits from './pages/admin/AdminBenefits'
import AdminCompanies from './pages/admin/AdminCompanies'
import AdminTimesheets from './pages/admin/AdminTimesheets'
import AdminPerformance from './pages/admin/AdminPerformance'
import AdminDemoSeed from './pages/admin/AdminDemoSeed'
import AdminNotifications from './pages/admin/AdminNotifications'
import AdminShiftsRotas from './pages/admin/AdminShiftsRotas'
import AdminSubscriptions from './pages/admin/AdminSubscriptions'
import AdminBilling from './pages/admin/AdminBilling'
import AdminLegalTimesheets from './pages/admin/AdminLegalTimesheets'
import AdminSpaceManagement from './pages/admin/AdminSpaceManagement'
import AdminAssetManagement from './pages/admin/AdminAssetManagement'
import AdminTalentIntelligence from './pages/admin/AdminTalentIntelligence'
import AdminUserGuides from './pages/admin/AdminUserGuides'
import AdminDashboardModern from './pages/admin/AdminDashboardModern'
import AdminAccess from './pages/admin/AdminAccess'
import AdminCancellations from './pages/admin/AdminCancellations'
import AdminGettingSetup from './pages/admin/AdminGettingSetup'
import AdminTeamsTest from './pages/admin/AdminTeamsTest'
import AdminIntegrations from './pages/admin/AdminIntegrations'
import AdminSurveys from './pages/admin/AdminSurveys'
import SurveyInsights from './pages/admin/SurveyInsights'
import MySurveys from './pages/MySurveys'
import UserGuide from './pages/UserGuide'
import SkillsPassport from './pages/SkillsPassport'
import TimesheetCheckIn from './pages/TimesheetCheckIn'
import ShiftCheckIn from './pages/ShiftCheckIn'
import CheckInPrompt from './components/CheckInPrompt'
import { CheckInProvider } from './context/CheckInContext'

function AdminGate() {
  const { companyUser, isSuperAdmin, portalRole } = useAuth()
  if (!isSuperAdmin && (!companyUser || (!['admin', 'hr'].includes(companyUser.role) && !portalRole))) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}

function AdminDashboardIndex() {
  const { isSuperAdmin } = useAuth()
  return isSuperAdmin ? <AdminDashboard /> : <AdminDashboardModern />
}

function SuperAdminGate() {
  const { isSuperAdmin } = useAuth()
  if (!isSuperAdmin) {
    return <Navigate to="/admin" replace />
  }
  return <Outlet />
}

function EmployeeRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/time-off" element={<Placeholder title="Time Off" />} />
      <Route path="/directory" element={<Directory />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/notifications/create" element={<CreateNotification />} />
      <Route path="/expenses" element={<Expenses />} />
      <Route path="/expenses/new" element={<NewExpenseClaim />} />
      <Route path="/expenses/:id" element={<ExpenseDetail />} />
      <Route path="/approve/expense/:id" element={<ExpenseApproval />} />
      <Route path="/approve/leave/:id" element={<LeaveApproval />} />
      <Route path="/approve/timesheet/:id" element={<TimesheetApproval />} />
      <Route path="/leave" element={<MyLeave />} />
      <Route path="/leave/history" element={<MyLeaveHistory />} />
      <Route path="/leave/calendar" element={<LeaveCalendar />} />
      <Route path="/leave/new" element={<NewLeaveRequest />} />
      <Route path="/leave/:id" element={<LeaveDetail />} />
      <Route path="/timesheets" element={<Timesheets />} />
      <Route path="/timesheets/checkin" element={<TimesheetCheckIn />} />
      <Route path="/timesheets/new" element={<NewTimesheet />} />
      <Route path="/timesheets/history" element={<TimesheetHistory />} />
      <Route path="/timesheets/:id" element={<TimesheetDetail />} />
      <Route path="/my-profile" element={<MyProfile />} />
      <Route path="/payslips" element={<Payslips />} />
      <Route path="/kudos" element={<Kudos />} />
      <Route path="/benefits" element={<Benefits />} />
      <Route path="/elearning" element={<ELearning />} />
      <Route path="/elearning/onb-getting-started" element={<GettingStartedCourse />} />
      <Route path="/elearning/:courseId" element={<CourseContent />} />
      <Route path="/one-to-ones" element={<OneToOnes />} />
      <Route path="/one-to-ones/new" element={<NewOneToOne />} />
      <Route path="/one-to-ones/:id" element={<OneToOneDetail />} />
      <Route path="/performance" element={<OneToOnes />} />
      <Route path="/performance/goals" element={<PerformanceGoals />} />
      <Route path="/shifts" element={<MyShifts />} />
      <Route path="/shifts/checkin" element={<ShiftCheckIn />} />
      <Route path="/shifts/swap" element={<ShiftSwap />} />
      <Route path="/shifts/availability" element={<Availability />} />
      <Route path="/legal-timesheets" element={<LegalTimesheets />} />
      <Route path="/space-booking" element={<SpaceBooking />} />
      <Route path="/announcements" element={<Placeholder title="Company Announcements" />} />
      <Route path="/user-guide" element={<UserGuide />} />
      <Route path="/skills-passport" element={<SkillsPassport />} />
      <Route path="/surveys" element={<MySurveys />} />
    </Routes>
  )
}

function FeatureLoader() {
  const { companyUser } = useAuth()
  const { loadCompanyFeatures } = useFeatures()
  useEffect(() => {
    if (companyUser?.company_id) loadCompanyFeatures(companyUser.company_id)
  }, [companyUser?.company_id, loadCompanyFeatures])
  return null
}

function AuthGate() {
  const { user, loading, companyUser, setupComplete, isSuperAdmin } = useAuth()
  const isDesktop = useMediaQuery('(min-width: 769px)')

  if (loading) {
    return <div className="auth-loading">Loading...</div>
  }

  if (!user) {
    return <Login />
  }

  if (!companyUser && !isSuperAdmin) {
    return <AccessDenied />
  }

  if (setupComplete === false) {
    return <InitialSetup />
  }

  if (isDesktop) {
    return (
      <CheckInProvider>
      <FeatureLoader />
      <CheckInPrompt />
      <Routes>
        <Route path="/admin" element={<AdminGate />}>
          <Route element={<AdminLayout />}>
            <Route index element={<AdminDashboardIndex />} />
          <Route path="dashboard-classic" element={<AdminDashboard />} />
            <Route path="getting-setup" element={<AdminGettingSetup />} />
            <Route path="expenses" element={<AdminExpenses />} />
            <Route path="leave" element={<AdminLeave />} />
            <Route path="payroll" element={<AdminPayroll />} />
            <Route path="employees" element={<AdminEmployees />} />
            <Route path="kudos" element={<AdminKudos />} />
            <Route path="elearning" element={<AdminELearning />} />
            <Route path="announcements" element={<AdminAnnouncements />} />
            <Route path="onboarding" element={<AdminOnboarding />} />
            <Route path="tickets" element={<AdminTickets />} />
            <Route path="benefits" element={<AdminBenefits />} />
            <Route path="timesheets" element={<AdminTimesheets />} />
            <Route path="performance" element={<AdminPerformance />} />
            <Route path="shifts" element={<AdminShiftsRotas />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="billing" element={<AdminBilling />} />
            <Route path="legal-timesheets" element={<AdminLegalTimesheets />} />
            <Route path="space-management" element={<AdminSpaceManagement />} />
            <Route path="assets" element={<AdminAssetManagement />} />
            <Route path="talent-intelligence" element={<AdminTalentIntelligence />} />
            <Route path="surveys" element={<AdminSurveys />} />
            <Route path="surveys/insights" element={<SurveyInsights />} />
            <Route path="user-guides" element={<AdminUserGuides />} />
            <Route path="integrations" element={<AdminIntegrations />} />
            <Route path="access" element={<AdminAccess />} />
            <Route element={<SuperAdminGate />}>
              <Route path="companies" element={<AdminCompanies />} />
              <Route path="subscriptions" element={<AdminSubscriptions />} />
              <Route path="cancellations" element={<AdminCancellations />} />
              <Route path="demo-seed" element={<AdminDemoSeed />} />
              <Route path="teams-test" element={<AdminTeamsTest />} />
            </Route>
          </Route>
        </Route>

        <Route element={<DesktopLayout />}>
          <Route path="*" element={<EmployeeRoutes />} />
        </Route>
      </Routes>
      </CheckInProvider>
    )
  }

  return (
    <CheckInProvider>
    <FeatureLoader />
    <CheckInPrompt />
    <Routes>
      {/* Admin Portal — locked to admin/hr roles */}
      <Route path="/admin" element={<AdminGate />}>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminDashboardModern />} />
          <Route path="dashboard-classic" element={<AdminDashboard />} />
          <Route path="getting-setup" element={<AdminGettingSetup />} />
          <Route path="expenses" element={<AdminExpenses />} />
          <Route path="leave" element={<AdminLeave />} />
          <Route path="payroll" element={<AdminPayroll />} />
          <Route path="employees" element={<AdminEmployees />} />
          <Route path="kudos" element={<AdminKudos />} />
          <Route path="elearning" element={<AdminELearning />} />
          <Route path="announcements" element={<AdminAnnouncements />} />
          <Route path="onboarding" element={<AdminOnboarding />} />
          <Route path="tickets" element={<AdminTickets />} />
          <Route path="benefits" element={<AdminBenefits />} />
          <Route path="timesheets" element={<AdminTimesheets />} />
          <Route path="shifts" element={<AdminShiftsRotas />} />
          <Route path="notifications" element={<AdminNotifications />} />
          <Route path="billing" element={<AdminBilling />} />
          <Route path="legal-timesheets" element={<AdminLegalTimesheets />} />
          <Route path="user-guides" element={<AdminUserGuides />} />
          <Route path="integrations" element={<AdminIntegrations />} />
          <Route path="access" element={<AdminAccess />} />
          <Route element={<SuperAdminGate />}>
            <Route path="companies" element={<AdminCompanies />} />
            <Route path="subscriptions" element={<AdminSubscriptions />} />
            <Route path="cancellations" element={<AdminCancellations />} />
            <Route path="demo-seed" element={<AdminDemoSeed />} />
            <Route path="teams-test" element={<AdminTeamsTest />} />
          </Route>
        </Route>
      </Route>

      {/* Employee App */}
      <Route path="*" element={
        <>
          <div className="app-shell">
            <div className="app-content">
              <EmployeeRoutes />
            </div>
          </div>
          <Footer />
        </>
      } />
    </Routes>
    </CheckInProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
      <LanguageProvider>
      <FeatureProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/privacy" element={<PrivacyNotice />} />
            <Route path="*" element={<AuthProvider><AuthGate /></AuthProvider>} />
          </Routes>
        </BrowserRouter>
      </FeatureProvider>
      </LanguageProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
