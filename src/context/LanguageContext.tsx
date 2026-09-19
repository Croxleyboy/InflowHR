import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { getTranslations, t as translate, tStatus as translateStatus, tExpenseType as translateExpenseType, tLeaveType as translateLeaveType, type Lang, type Translations } from '../lib/translations'

interface LanguageContextType {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string) => string
  tStatus: (status: string) => string
  tExpenseType: (type: string) => string
  tLeaveType: (key: string) => string
  fyStartMonth: number
  setFyStartMonth: (month: number) => void
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'en',
  setLang: () => {},
  t: (key: string) => key,
  tStatus: (s: string) => s,
  tExpenseType: (s: string) => s,
  tLeaveType: (s: string) => s,
  fyStartMonth: 4,
  setFyStartMonth: () => {},
})

export function useLanguage() {
  return useContext(LanguageContext)
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    return (localStorage.getItem('inflowhr-lang') as Lang) || 'en'
  })
  const [fyStartMonth, setFyStartMonthState] = useState(4)
  const [translations, setTranslations] = useState<Translations>(() => getTranslations('en'))

  useEffect(() => {
    supabase.from('app_settings').select('language, financial_year_start_month').limit(1).single()
      .then(({ data }) => {
        if (data) {
          const dbLang = (data.language as Lang) || 'en'
          setLangState(dbLang)
          localStorage.setItem('inflowhr-lang', dbLang)
          setTranslations(getTranslations(dbLang))
          setFyStartMonthState(data.financial_year_start_month || 4)
        }
      })
  }, [])

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang)
    localStorage.setItem('inflowhr-lang', newLang)
    setTranslations(getTranslations(newLang))
  }, [])

  const setFyStartMonth = useCallback((month: number) => {
    setFyStartMonthState(month)
  }, [])

  const tFn = useCallback((key: string) => translate(translations, key), [translations])
  const tStatusFn = useCallback((status: string) => translateStatus(translations, status), [translations])
  const tExpenseTypeFn = useCallback((type: string) => translateExpenseType(translations, type), [translations])
  const tLeaveTypeFn = useCallback((key: string) => translateLeaveType(translations, key), [translations])

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: tFn, tStatus: tStatusFn, tExpenseType: tExpenseTypeFn, tLeaveType: tLeaveTypeFn, fyStartMonth, setFyStartMonth }}>
      {children}
    </LanguageContext.Provider>
  )
}
