import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

interface ThemeContextType {
  dark: boolean
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextType>({ dark: false, toggle: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('inflowhr-theme') === 'dark' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('inflowhr-theme', dark ? 'dark' : 'light') } catch { /* empty */ }
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      supabase.from('company_users').select('theme').eq('auth_user_id', data.user.id).eq('is_active', true).limit(1).single()
        .then(({ data: cu }) => {
          if (cu?.theme) setDark(cu.theme === 'dark')
        })
    })
  }, [])

  const toggle = useCallback(() => {
    setDark(prev => {
      const next = !prev
      supabase.auth.getUser().then(({ data }) => {
        if (!data.user) return
        supabase.from('company_users').update({ theme: next ? 'dark' : 'light' }).eq('auth_user_id', data.user.id).eq('is_active', true)
      })
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
