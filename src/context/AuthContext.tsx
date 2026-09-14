import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { supabase, signInDirect } from '../lib/supabase'
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
  is_trial: boolean
  trial_end_date: string | null
  trial_expired?: boolean
  cancellation_status?: string | null
  is_cancelled?: boolean
}

const SUPER_ADMIN_EMAILS = [
  import.meta.env.VITE_SUPER_ADMIN_EMAIL,
  import.meta.env.VITE_BREAK_GLASS_EMAIL,
].filter(Boolean).map((e: string) => e.toLowerCase())

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
  portalRole: string | null
  avatarUrl: string | null
  updateAvatarUrl: (url: string) => void
  setupComplete: boolean | null
  markSetupComplete: () => void
  signInWithMicrosoft: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<string | null>
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
  const [portalRole, setPortalRole] = useState<string | null>(null)

  async function loadCompanyData(userId: string, email: string) {
    // Step 1: RPC ensures company_users row exists, claims orphans, resolves employee by local-part match
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rpcResult } = await supabase.rpc('ensure_company_user' as any)

    // Step 2: Re-query company_users to get the authoritative row (RPC may have updated it)
    const { data: rows } = await supabase
      .from('company_users')
      .select('id, company_id, role, employee_id')
      .eq('auth_user_id', userId)
      .eq('is_active', true)

    // Prefer the row with employee_id linked, then admin, then any
    let cu = rows && rows.length > 0
      ? rows.find((r: any) => r.role === 'admin' && r.employee_id)
        || rows.find((r: any) => r.employee_id != null)
        || rows.find((r: any) => r.role === 'admin')
        || rows[0]
      : null

    // If direct query found nothing but RPC succeeded, use RPC result as fallback
    if (!cu && rpcResult && !rpcResult.error) {
      cu = rpcResult
    }

    if (cu) {
      let empId = cu.employee_id

      // Step 3: If employee_id still missing, resolve it client-side
      if (!empId && email && cu.company_id) {
        const localPart = email.split('@')[0]
        // Try exact email, then local-part match
        let { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('email', email)
          .eq('company_id', cu.company_id)
          .maybeSingle()
        if (!emp) {
          const { data: fuzzy } = await supabase
            .from('employees')
            .select('id')
            .eq('company_id', cu.company_id)
            .ilike('email', `${localPart}@%`)
            .limit(1)
            .maybeSingle()
          emp = fuzzy
        }
        if (emp) {
          empId = emp.id
          await supabase
            .from('company_users')
            .update({ employee_id: emp.id })
            .eq('id', cu.id)
        }
      }

      // Step 4: Sync role from employees.is_admin flag
      if (empId) {
        const { data: empRow } = await supabase
          .from('employees')
          .select('is_admin')
          .eq('id', empId)
          .single()
        if (empRow) {
          const expectedRole = empRow.is_admin ? 'admin' : (cu.role === 'admin' ? 'admin' : cu.role)
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
        .select('id, name, domain, logo_url, login_disabled, is_trial, trial_end_date, cancellation_status')
        .eq('id', cu.company_id)
        .single()
      if (co) {
        const trialExpired = co.is_trial && co.trial_end_date && new Date(co.trial_end_date) < new Date()
        const isCancelled = co.cancellation_status && ['frozen', 'exported', 'completed', 'purged'].includes(co.cancellation_status)
        if (co.login_disabled || trialExpired || isCancelled) {
          setCompanyUser(null)
          setCompany({ ...co, trial_expired: !!trialExpired, is_cancelled: !!isCancelled } as Company)
          setSetupComplete(null)
          return
        }
        setCompany(co as Company)
      }

      let { data: onbRows } = await supabase
        .from('onboarding')
        .select('initial_setup_complete, avatar_url')
        .eq('user_email', email)
        .eq('company_id', cu.company_id)
        .order('id', { ascending: false })
        .limit(1)
      let onb = onbRows?.[0] || null
      if (!onb) {
        const lp = email.split('@')[0].toLowerCase()
        const { data: onbFuzzy } = await supabase
          .from('onboarding')
          .select('initial_setup_complete, avatar_url')
          .eq('company_id', cu.company_id)
          .ilike('user_email', `${lp}@%`)
          .order('id', { ascending: false })
          .limit(1)
        onb = onbFuzzy?.[0] || null
      }
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

        supabase.from('admin_portal_access')
          .select('role_key')
          .eq('employee_id', empId)
          .eq('company_id', cu.company_id)
          .maybeSingle()
          .then(({ data }) => setPortalRole(data?.role_key || null))
      }
    } else {
      // No active company_users row — check if user has a deactivated row in a cancelled company
      const { data: inactiveRows } = await supabase
        .from('company_users')
        .select('company_id')
        .eq('auth_user_id', userId)
        .eq('is_active', false)
        .limit(1)
      if (inactiveRows && inactiveRows.length > 0) {
        const { data: co } = await supabase
          .from('companies')
          .select('id, name, domain, logo_url, login_disabled, is_trial, trial_end_date, cancellation_status')
          .eq('id', inactiveRows[0].company_id)
          .single()
        if (co && co.cancellation_status && ['frozen', 'exported', 'completed', 'purged'].includes(co.cancellation_status)) {
          setCompany({ ...co, is_cancelled: true } as Company)
          setSetupComplete(null)
          return
        }
      }
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

  async function signInWithPassword(email: string, password: string): Promise<string | null> {
    const { error } = await signInDirect(email, password)
    return error
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
    setPortalRole(null)
  }

  const INACTIVITY_TIMEOUT = 15 * 60 * 1000
  const ACTIVITY_STORAGE_KEY = 'inflowhr_last_activity'
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const signOutInactive = useCallback(async () => {
    sessionStorage.removeItem(ACTIVITY_STORAGE_KEY)
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setCompanyUser(null)
    setCompany(null)
    setEmployeeId(null)
    setIsManager(false)
    setCanPostNotifications(false)
    setPortalRole(null)
    window.location.href = '/'
  }, [])

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    if (!session) return
    sessionStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()))
    inactivityTimer.current = setTimeout(() => { signOutInactive() }, INACTIVITY_TIMEOUT)
  }, [session, signOutInactive])

  useEffect(() => {
    if (!session) return
    const lastActivity = Number(sessionStorage.getItem(ACTIVITY_STORAGE_KEY) || 0)
    if (lastActivity > 0 && Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
      signOutInactive()
      return
    }
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove']
    const handler = () => resetInactivityTimer()
    events.forEach(e => window.addEventListener(e, handler, { passive: true }))
    resetInactivityTimer()

    const crossTabCheck = setInterval(() => {
      const ts = Number(sessionStorage.getItem(ACTIVITY_STORAGE_KEY) || 0)
      if (ts > 0 && Date.now() - ts > INACTIVITY_TIMEOUT) signOutInactive()
    }, 30_000)

    return () => {
      events.forEach(e => window.removeEventListener(e, handler))
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      clearInterval(crossTabCheck)
    }
  }, [session, resetInactivityTimer, signOutInactive])

  const employeeName = user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  const employeeEmail = user?.email || ''
  const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(employeeEmail.toLowerCase())

  return (
    <AuthContext.Provider value={{ user, session, companyUser, company, loading, employeeId, avatarUrl, updateAvatarUrl, employeeName, employeeEmail, isSuperAdmin, isManager, canPostNotifications, portalRole, setupComplete, markSetupComplete, signInWithMicrosoft, signInWithPassword, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
