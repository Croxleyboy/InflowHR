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
  loading: boolean
}

const AdminCompanyContext = createContext<AdminCompanyState | null>(null)

export function useAdminCompany() {
  const ctx = useContext(AdminCompanyContext)
  if (!ctx) throw new Error('useAdminCompany must be used within AdminCompanyProvider')
  return ctx
}

export function AdminCompanyProvider({ children }: { children: ReactNode }) {
  const { isSuperAdmin, company } = useAuth()
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (isSuperAdmin) {
        const { data } = await supabase.from('companies').select('id, name, domain, is_active').order('name')
        const list = (data as Company[]) || []
        setCompanies(list)
        if (!selectedCompanyId && list.length > 0) {
          setSelectedCompanyId(company?.id || list[0].id)
        }
        setLoading(false)
      } else if (company) {
        setCompanies([{ id: company.id, name: company.name, domain: company.domain, is_active: true }])
        setSelectedCompanyId(company.id)
        setLoading(false)
      }
    }
    load()
  }, [isSuperAdmin, company])

  const selectedCompany = companies.find(c => c.id === selectedCompanyId) || null

  return (
    <AdminCompanyContext.Provider value={{ companies, selectedCompanyId, selectedCompany, setSelectedCompanyId, loading }}>
      {children}
    </AdminCompanyContext.Provider>
  )
}
