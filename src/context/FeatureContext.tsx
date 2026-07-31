import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

export interface Features {
  expenses: boolean
  leave: boolean
  profile: boolean
  payslips: boolean
  kudos: boolean
  benefits: boolean
  elearning: boolean
  performance: boolean
  timesheets: boolean
  shifts: boolean
  legal_timesheets: boolean
  space_booking: boolean
}

const STANDARD_FEATURES: (keyof Features)[] = ['expenses', 'leave', 'profile', 'kudos']
const ADDON_FEATURE_KEYS: Record<string, keyof Features> = {
  timesheets: 'timesheets',
  performance: 'performance',
  shifts: 'shifts',
  payroll: 'payslips',
  elearning: 'elearning',
  benefits: 'benefits',
  legal_timesheets: 'legal_timesheets',
  space_booking: 'space_booking',
}

const defaultFeatures: Features = {
  expenses: true,
  leave: true,
  profile: true,
  payslips: true,
  kudos: true,
  benefits: true,
  elearning: true,
  performance: true,
  timesheets: true,
  shifts: true,
  legal_timesheets: true,
  space_booking: true,
}

interface FeatureContextType {
  features: Features
  companyFeatures: Features
  setFeatures: (f: Features) => void
  loadCompanyFeatures: (companyId: string) => Promise<void>
  featuresLoaded: boolean
}

const FeatureContext = createContext<FeatureContextType>({
  features: defaultFeatures,
  companyFeatures: defaultFeatures,
  setFeatures: () => {},
  loadCompanyFeatures: async () => {},
  featuresLoaded: false,
})

export function FeatureProvider({ children }: { children: ReactNode }) {
  const [features, setFeaturesState] = useState<Features>(defaultFeatures)
  const [companyFeatures, setCompanyFeatures] = useState<Features>(defaultFeatures)
  const [featuresLoaded, setFeaturesLoaded] = useState(false)

  const loadCompanyFeatures = useCallback(async (companyId: string) => {
    const { data: companyFeaturesData } = await supabase
      .from('company_features')
      .select('feature_key, is_enabled')
      .eq('company_id', companyId)

    if (!companyFeaturesData || companyFeaturesData.length === 0) {
      setFeaturesState(defaultFeatures)
      setCompanyFeatures(defaultFeatures)
      setFeaturesLoaded(true)
      return
    }

    const enabledAddons = new Set(
      companyFeaturesData.filter(f => f.is_enabled).map(f => f.feature_key)
    )

    const newFeatures: Features = { ...defaultFeatures }
    for (const key of STANDARD_FEATURES) {
      newFeatures[key] = true
    }
    for (const [dbKey, featureKey] of Object.entries(ADDON_FEATURE_KEYS)) {
      newFeatures[featureKey] = enabledAddons.has(dbKey)
    }

    setCompanyFeatures({ ...newFeatures })
    setFeaturesState(newFeatures)
    setFeaturesLoaded(true)
  }, [])

  const setFeatures = (f: Features) => {
    setFeaturesState(f)
  }

  return (
    <FeatureContext.Provider value={{ features, companyFeatures, setFeatures, loadCompanyFeatures, featuresLoaded }}>
      {children}
    </FeatureContext.Provider>
  )
}

export const useFeatures = () => useContext(FeatureContext)
