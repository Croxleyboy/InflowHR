import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

interface EmployeeEntry {
  id: string
  first_name: string
  last_name: string
  avatar_url: string | null
}

export function useEmployeeLookup() {
  const { companyUser } = useAuth()
  const [employees, setEmployees] = useState<EmployeeEntry[]>([])
  const [nameMap, setNameMap] = useState<Record<string, string>>({})
  const [avatarMap, setAvatarMap] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (!companyUser?.company_id) return
    supabase.from('employees')
      .select('id, first_name, last_name, avatar_url')
      .eq('company_id', companyUser.company_id)
      .eq('is_active', true)
      .order('first_name')
      .then(({ data }) => {
        const list = (data || []) as EmployeeEntry[]
        setEmployees(list)
        const names: Record<string, string> = {}
        const avatars: Record<string, string | null> = {}
        list.forEach(e => {
          names[e.id] = `${e.first_name} ${e.last_name}`
          avatars[e.id] = e.avatar_url
        })
        setNameMap(names)
        setAvatarMap(avatars)
      })
  }, [companyUser?.company_id])

  return { employees, nameMap, avatarMap }
}
