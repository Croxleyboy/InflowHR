import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

interface CompanyUser {
  id: string
  company_id: string
  role: 'admin' | 'employee' | 'hr'
  employee_id: string | null
}

interface Company {
  id: string
  name: string
  domain: string
  logo_url: string | null
  login_disabled: boolean
}

const SUPER_ADMIN_EMAIL = (import.meta.env.VITE_SUPER_ADMIN_EMAIL || 'andy.jones@kumonix.com').toLowerCase()

interface AuthState {
  user: User | null
  session: Session | null
  companyUser: CompanyUser | null
  company: Company | null
  loading: boolean
  employeeId: string | null
  employeeName: string
  employeeEmail: string
  isSuperAdmin: boolean
  isManager: boolean
  canPostNotifications: boolean
  avatarUrl: string | null
  updateAvatarUrl: (url: string) => void
  setupComplete: boolean | null
  markSetupComplete: () => void
  signInWithMicrosoft: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [companyUser, setCompanyUser] = useState<CompanyUser | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)

  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null)
  const [isManager, setIsManager] = useState(false)
  const [canPostNotifications, setCanPostNotifications] = useState(false)

  async function loadCompanyData(userId: string, email: string) {
    const { data: rows } = await supabase
      .from('company_users')
      .select('id, company_id, role, employee_id')
      .eq('auth_user_id', userId)
      .eq('is_active', true)

    let cu = rows && rows.length > 0
      ? rows.find(r => r.role === 'admin' && r.employee_id)
        || rows.find(r => r.employee_id != null)
        || rows.find(r => r.role === 'admin')
        || rows[0]
      : null

    if (!cu && email) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: result } = await supabase.rpc('ensure_company_user' as any)
      if (result && !result.error) {
        cu = result
      }
    }

    if (cu) {
      let empId = cu.employee_id
      if (!empId && email) {
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('email', email)
          .eq('company_id', cu.company_id)
          .maybeSingle()
        if (emp) {
          empId = emp.id
          await supabase
            .from('company_users')
            .update({ employee_id: emp.id })
            .eq('id', cu.id)
        }
      }

      if (empId) {
        const { data: empRow } = await supabase
          .from('employees')
          .select('is_admin')
          .eq('id', empId)
          .single()
        if (empRow) {
          const expectedRole = empRow.is_admin ? 'admin' : cu.role
          if (expectedRole !== cu.role) {
            cu = { ...cu, role: expectedRole }
            await supabase
              .from('company_users')
              .update({ role: expectedRole })
              .eq('id', cu.id)
          }
        }
      }

      setCompanyUser(cu as CompanyUser)
      setEmployeeId(empId)

      const { data: co } = await supabase
        .from('companies')
        .select('id, name, domain, logo_url, login_disabled')
        .eq('id', cu.company_id)
        .single()
      if (co) {
        if (co.login_disabled) {
          setCompanyUser(null)
          setCompany(co as Company)
          setSetupComplete(null)
          return
        }
        setCompany(co as Company)
      }

      const { data: onb } = await supabase
        .from('onboarding')
        .select('initial_setup_complete, avatar_url')
        .eq('user_email', email)
        .eq('company_id', cu.company_id)
        .maybeSingle()
      setSetupComplete(onb ? onb.initial_setup_complete === true : true)
      setAvatarUrl(onb?.avatar_url || null)

      if (empId) {
        supabase.from('employees')
          .select('id', { count: 'exact', head: true })
          .eq('manager_id', empId)
          .eq('is_active', true)
          .eq('company_id', cu.company_id)
          .then(({ count }) => setIsManager((count || 0) > 0))

        supabase.from('employees')
          .select('can_post_notifications')
          .eq('id', empId)
          .eq('company_id', cu.company_id)
          .single()
          .then(({ data }) => setCanPostNotifications(data?.can_post_notifications === true))
      }
    } else {
      setSetupComplete(null)
    }
  }

  function markSetupComplete() {
    setSetupComplete(true)
  }

  function updateAvatarUrl(url: string) {
    setAvatarUrl(url)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) {
        loadCompanyData(s.user.id, s.user.email || '').finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) {
        loadCompanyData(s.user.id, s.user.email || '').finally(() => setLoading(false))
      } else {
        setCompanyUser(null)
        setCompany(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signInWithMicrosoft() {
    await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'openid email profile',
        redirectTo: window.location.origin,
        queryParams: {
          prompt: 'select_account',
        },
      },
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setCompanyUser(null)
    setCompany(null)
    setEmployeeId(null)
    setIsManager(false)
    setCanPostNotifications(false)
  }

  const employeeName = user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  const employeeEmail = user?.email || ''
  const isSuperAdmin = employeeEmail.toLowerCase() === SUPER_ADMIN_EMAIL

  return (
    <AuthContext.Provider value={{ user, session, companyUser, company, loading, employeeId, avatarUrl, updateAvatarUrl, employeeName, employeeEmail, isSuperAdmin, isManager, canPostNotifications, setupComplete, markSetupComplete, signInWithMicrosoft, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
