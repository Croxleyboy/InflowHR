import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export function useNotificationBadge() {
  const { employeeEmail, companyUser } = useAuth()
  const [badgeCount, setBadgeCount] = useState(0)

  useEffect(() => {
    if (!employeeEmail || !companyUser?.company_id) return
    const fetchCount = () => {
      supabase.from('workflow_tracker')
        .select('id', { count: 'exact', head: true })
        .ilike('assigned_to', `%${employeeEmail}%`)
        .eq('status', 'Pending')
        .eq('company_id', companyUser.company_id)
        .then(({ count }) => setBadgeCount(count || 0))
    }
    fetchCount()
    window.addEventListener('notifications-updated', fetchCount)
    return () => window.removeEventListener('notifications-updated', fetchCount)
  }, [employeeEmail, companyUser?.company_id])

  return badgeCount
}
