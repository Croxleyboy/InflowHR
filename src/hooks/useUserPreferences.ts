import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export interface UserPreferences {
  dashboard_layout: string
  dashboard_mode: string
  info_card_order: string[] | null
  info_card_hidden: string[] | null
  dd2_columns: Record<string, boolean> | null
  dd2_hero_img: number
  dd2_hide_pay: boolean
  kudos_watchlist: string[] | null
  kudos_colleagues_only: boolean
}

const DEFAULTS: UserPreferences = {
  dashboard_layout: 'detailed',
  dashboard_mode: 'info',
  info_card_order: null,
  info_card_hidden: null,
  dd2_columns: null,
  dd2_hero_img: 0,
  dd2_hide_pay: false,
  kudos_watchlist: null,
  kudos_colleagues_only: false,
}

const CACHE_KEY = 'inflowhr-user-prefs'

function readCache(): Partial<UserPreferences> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* empty */ }
  return {}
}

function writeCache(prefs: UserPreferences) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(prefs)) } catch { /* empty */ }
}

export function useUserPreferences() {
  const { employeeId, companyUser } = useAuth()
  const companyId = companyUser?.company_id
  const [prefs, setPrefs] = useState<UserPreferences>(() => ({ ...DEFAULTS, ...readCache() }))
  const [loaded, setLoaded] = useState(false)
  const rowIdRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Partial<UserPreferences>>({})

  useEffect(() => {
    if (!companyId || !employeeId) return
    supabase
      .from('user_preferences')
      .select('*')
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          rowIdRef.current = data.id
          const merged: UserPreferences = {
            dashboard_layout: data.dashboard_layout || DEFAULTS.dashboard_layout,
            dashboard_mode: data.dashboard_mode || DEFAULTS.dashboard_mode,
            info_card_order: data.info_card_order,
            info_card_hidden: data.info_card_hidden,
            dd2_columns: data.dd2_columns as Record<string, boolean> | null,
            dd2_hero_img: data.dd2_hero_img ?? 0,
            dd2_hide_pay: data.dd2_hide_pay ?? false,
            kudos_watchlist: data.kudos_watchlist,
            kudos_colleagues_only: data.kudos_colleagues_only ?? false,
          }
          setPrefs(merged)
          writeCache(merged)
        }
        setLoaded(true)
      })
  }, [companyId, employeeId])

  const updatePref = useCallback(<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value }
      writeCache(next)
      return next
    })

    Object.assign(pendingRef.current, { [key]: value })

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (!companyId || !employeeId) return
      const updates = { ...pendingRef.current, updated_at: new Date().toISOString() }
      pendingRef.current = {}

      if (rowIdRef.current) {
        supabase.from('user_preferences').update(updates).eq('id', rowIdRef.current).then()
      } else {
        supabase.from('user_preferences').insert({
          company_id: companyId,
          employee_id: employeeId,
          ...updates,
        }).select('id').single().then(({ data }) => {
          if (data) rowIdRef.current = data.id
        })
      }
    }, 500)
  }, [companyId, employeeId])

  return { prefs, loaded, updatePref }
}
