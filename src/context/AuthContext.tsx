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

const SUPER_ADMIN_EMAIL = 'andy.jones@kumonix.com'

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
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null)

  async function loadCompanyData(userId: string, email: string) {
    const { data: rows } = await supabase
      .from('company_users')
      .select('id, company_id, role, employee_id')
      .eq('auth_user_id', userId)
      .eq('is_active', true)

    let cu = rows && rows.length > 0
      ? rows.find(r => r.role === 'admin') || rows[0]
      : null

    if (!cu && email) {
      const { data: result } = await (supabase.rpc as any)('ensure_company_user')
      if (result && !result.error) {
        cu = result
      }
    }

    if (cu) {
      setCompanyUser(cu as CompanyUser)

      let empId = cu.employee_id
      if (!empId && email) {
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('email', email)
          .maybeSingle()
        if (emp) {
          empId = emp.id
          await supabase
            .from('company_users')
            .update({ employee_id: emp.id })
            .eq('id', cu.id)
        }
      }
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
        .select('initial_setup_complete')
        .eq('user_email', email)
        .maybeSingle()
      setSetupComplete(onb?.initial_setup_complete === true)
    } else {
      setSetupComplete(null)
    }
  }

  function markSetupComplete() {
    setSetupComplete(true)
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
  }

  const employeeName = user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  const employeeEmail = user?.email || ''
  const isSuperAdmin = employeeEmail.toLowerCase() === SUPER_ADMIN_EMAIL

  return (
    <AuthContext.Provider value={{ user, session, companyUser, company, loading, employeeId, employeeName, employeeEmail, isSuperAdmin, setupComplete, markSetupComplete, signInWithMicrosoft, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
