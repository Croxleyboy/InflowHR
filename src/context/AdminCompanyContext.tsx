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
}

const AdminCompanyContext = createContext<AdminCompanyState | null>(null)

export function useAdminCompany() {
  const ctx = useContext(AdminCompanyContext)
  if (!ctx) throw new Error('useAdminCompany must be used within AdminCompanyProvider')
  return ctx
}

export function AdminCompanyProvider({ children }: { children: ReactNode }) {
  const { isSuperAdmin, company } = useAuth()

  const [companies, setCompanies] = useState<Company[]>(() => {
    if (company) return [{ id: company.id, name: company.name, domain: company.domain, is_active: true }]
    return []
  })
  const [selectedCompanyId, setSelectedCompanyId] = useState(() => company?.id || '')

  useEffect(() => {
    if (!isSuperAdmin) return
    let cancelled = false
    supabase.from('companies').select('id, name, domain, is_active').order('name').then(({ data }) => {
      if (cancelled) return
      const list = (data as Company[]) || []
      setCompanies(list)
      if (list.length > 0) {
        setSelectedCompanyId(prev => prev || list[0].id)
      }
    })
    return () => { cancelled = true }
  }, [isSuperAdmin])

  const selectedCompany = companies.find(c => c.id === selectedCompanyId) || null

  return (
    <AdminCompanyContext.Provider value={{ companies, selectedCompanyId, selectedCompany, setSelectedCompanyId }}>
      {children}
    </AdminCompanyContext.Provider>
  )
}
