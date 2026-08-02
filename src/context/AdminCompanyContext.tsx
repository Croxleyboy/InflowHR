import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

interface Company {
  id: string
  name: string
  domain: string
  is_active: boolean
}

interface AdminCompanyState {
  companies: Company[]
  selectedCompanyId: string
  selectedCompany: Company | null
  setSelectedCompanyId: (id: string) => void
  ready: boolean
}

const AdminCompanyContext = createContext<AdminCompanyState | null>(null)

export function useAdminCompany() {
  const ctx = useContext(AdminCompanyContext)
  if (!ctx) throw new Error('useAdminCompany must be used within AdminCompanyProvider')
  return ctx
}

export function AdminCompanyProvider({ children }: { children: ReactNode }) {
  const { isSuperAdmin, company } = useAuth()

  const initialId = company?.id || ''
  const initialCompanies: Company[] = company
    ? [{ id: company.id, name: company.name, domain: company.domain, is_active: true }]
    : []

  const [companies, setCompanies] = useState<Company[]>(initialCompanies)
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialId)
  const [ready, setReady] = useState(!isSuperAdmin && !!company)

  useEffect(() => {
    if (!isSuperAdmin) {
      if (company) {
        setCompanies([{ id: company.id, name: company.name, domain: company.domain, is_active: true }])
        setSelectedCompanyId(company.id)
        setReady(true)
      }
      return
    }
    let cancelled = false
    async function loadCompanies() {
      const { data } = await supabase.from('companies').select('id, name, domain, is_active').order('name')
      if (cancelled) return
      const list = (data as Company[]) || []
      setCompanies(list)
      setSelectedCompanyId(prev => prev || company?.id || (list.length > 0 ? list[0].id : ''))
      setReady(true)
    }
    loadCompanies()
    return () => { cancelled = true }
  }, [isSuperAdmin, company])

  const selectedCompany = companies.find(c => c.id === selectedCompanyId) || null

  return (
    <AdminCompanyContext.Provider value={{ companies, selectedCompanyId, selectedCompany, setSelectedCompanyId, ready }}>
      {children}
    </AdminCompanyContext.Provider>
  )
}
