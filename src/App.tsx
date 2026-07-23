import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { FeatureProvider } from './context/FeatureContext'
import { LanguageProvider } from './context/LanguageContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import AccessDenied from './pages/AccessDenied'
import Footer from './components/Footer'
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
import AdminDemoSeed from './pages/admin/AdminDemoSeed'

function AdminGate() {
  const { companyUser } = useAuth()
  if (!companyUser || !['admin', 'hr'].includes(companyUser.role)) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}

function AuthGate() {
  const { user, loading, companyUser } = useAuth()

  if (loading) {
    return <div className="auth-loading">Loading...</div>
  }

  if (!user) {
    return <Login />
  }

  if (!companyUser) {
    return <AccessDenied />
  }

  return (
    <Routes>
      {/* Admin Portal — locked to admin/hr roles */}
      <Route path="/admin" element={<AdminGate />}>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
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
          <Route path="companies" element={<AdminCompanies />} />
          <Route path="demo-seed" element={<AdminDemoSeed />} />
        </Route>
      </Route>

      {/* Employee App */}
      <Route path="*" element={
        <div className="app-shell">
          <div className="app-content">
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
              <Route path="/leave" element={<MyLeave />} />
              <Route path="/leave/history" element={<MyLeaveHistory />} />
              <Route path="/leave/calendar" element={<LeaveCalendar />} />
              <Route path="/leave/new" element={<NewLeaveRequest />} />
              <Route path="/leave/:id" element={<LeaveDetail />} />
              <Route path="/my-profile" element={<MyProfile />} />
              <Route path="/payslips" element={<Payslips />} />
              <Route path="/kudos" element={<Kudos />} />
              <Route path="/benefits" element={<Benefits />} />
              <Route path="/elearning" element={<ELearning />} />
              <Route path="/performance" element={<Placeholder title="Performance" />} />
              <Route path="/announcements" element={<Placeholder title="Company Announcements" />} />
            </Routes>
          </div>
          <Footer />
        </div>
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
      <FeatureProvider>
        <BrowserRouter>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </BrowserRouter>
      </FeatureProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}
