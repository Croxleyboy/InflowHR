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

    // If no company_users row found by auth_user_id, check for a pre-created row
    // (e.g. from the setup wizard) that has a matching employee email but no auth_user_id yet
    if (!cu && email) {
      const domain = email.split('@')[1]?.toLowerCase()
      if (domain) {
        const { data: co } = await supabase
          .from('companies')
          .select('id')
          .eq('domain', domain)
          .eq('is_active', true)
          .maybeSingle()
        if (co) {
          const { data: emp } = await supabase
            .from('employees')
            .select('id')
            .eq('email', email)
            .eq('company_id', co.id)
            .maybeSingle()
          if (emp) {
            const { data: pendingCu } = await supabase
              .from('company_users')
              .select('id, company_id, role, employee_id')
              .eq('employee_id', emp.id)
              .is('auth_user_id', null)
              .maybeSingle()
            if (pendingCu) {
              await supabase
                .from('company_users')
                .update({ auth_user_id: userId })
                .eq('id', pendingCu.id)
              cu = pendingCu
            }
          }
        }
      }
    }

    if (!cu && email) {
      const { data: result } = await (supabase.rpc as any)('ensure_company_user')
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
  }

  const employeeName = user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  const employeeEmail = user?.email || ''
  const isSuperAdmin = employeeEmail.toLowerCase() === SUPER_ADMIN_EMAIL

  return (
    <AuthContext.Provider value={{ user, session, companyUser, company, loading, employeeId, avatarUrl, updateAvatarUrl, employeeName, employeeEmail, isSuperAdmin, setupComplete, markSetupComplete, signInWithMicrosoft, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
