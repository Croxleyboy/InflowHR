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
  asset_management: boolean
  skills_passport: boolean
  email_notifications: boolean
  teams_integration: boolean
  xero_integration: boolean
  sage_integration: boolean
  modulr_integration: boolean
  surveys: boolean
  employee_help: boolean
  ai_help_agent: boolean
  inflowonboarder_integration: boolean
}

const STANDARD_FEATURES: (keyof Features)[] = ['expenses', 'leave', 'profile', 'kudos', 'asset_management', 'benefits', 'xero_integration', 'sage_integration', 'payslips', 'surveys', 'employee_help']
const ADDON_FEATURE_KEYS: Record<string, keyof Features> = {
  timesheets: 'timesheets',
  performance: 'performance',
  shifts: 'shifts',
  payroll: 'payslips',
  elearning: 'elearning',
  legal_timesheets: 'legal_timesheets',
  space_booking: 'space_booking',
  skills_passport: 'skills_passport',
  teams_integration: 'teams_integration',
  email_notifications: 'email_notifications',
  ai_help_agent: 'ai_help_agent',
  inflowonboarder_integration: 'inflowonboarder_integration',
}
const PACK_A_FEATURES: (keyof Features)[] = ['shifts', 'legal_timesheets', 'space_booking', 'asset_management']
const PACK_B_FEATURES: (keyof Features)[] = ['teams_integration', 'skills_passport', 'modulr_integration', 'ai_help_agent']

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
  asset_management: true,
  skills_passport: true,
  email_notifications: true,
  teams_integration: false,
  xero_integration: false,
  sage_integration: false,
  modulr_integration: false,
  surveys: true,
  employee_help: true,
  ai_help_agent: false,
  inflowonboarder_integration: false,
}

interface FeatureContextType {
  features: Features
  companyFeatures: Features
  dashboardStyle: 'default' | 'slim'
  setFeatures: (f: Features) => void
  loadCompanyFeatures: (companyId: string) => Promise<void>
  featuresLoaded: boolean
}

const FeatureContext = createContext<FeatureContextType>({
  features: defaultFeatures,
  dashboardStyle: 'default',
  companyFeatures: defaultFeatures,
  setFeatures: () => {},
  loadCompanyFeatures: async () => {},
  featuresLoaded: false,
})

export function FeatureProvider({ children }: { children: ReactNode }) {
  const [features, setFeaturesState] = useState<Features>(defaultFeatures)
  const [companyFeatures, setCompanyFeatures] = useState<Features>(defaultFeatures)
  const [dashboardStyle, setDashboardStyle] = useState<'default' | 'slim'>('default')
  const [featuresLoaded, setFeaturesLoaded] = useState(false)

  const loadCompanyFeatures = useCallback(async (companyId: string) => {
    const [{ data: companyFeaturesData }, { data: companyRow }] = await Promise.all([
      supabase.from('company_features').select('feature_key, is_enabled, is_visible').eq('company_id', companyId),
      supabase.from('companies').select('dashboard_style').eq('id', companyId).single(),
    ])

    if (companyRow?.dashboard_style === 'slim') setDashboardStyle('slim')
    else setDashboardStyle('default')

    if (!companyFeaturesData || companyFeaturesData.length === 0) {
      setFeaturesState(defaultFeatures)
      setCompanyFeatures(defaultFeatures)
      setFeaturesLoaded(true)
      return
    }

    const dbRows = new Map(
      companyFeaturesData.map(f => [f.feature_key, f])
    )

    const subscribed: Features = { ...defaultFeatures }
    const visible: Features = { ...defaultFeatures }

    for (const key of STANDARD_FEATURES) {
      const row = dbRows.get(key)
      subscribed[key] = row?.is_enabled ?? true
      visible[key] = subscribed[key] && (row?.is_visible ?? true)
    }
    for (const [dbKey, featureKey] of Object.entries(ADDON_FEATURE_KEYS)) {
      const row = dbRows.get(dbKey)
      subscribed[featureKey] = row?.is_enabled ?? false
      visible[featureKey] = subscribed[featureKey] && (row?.is_visible ?? true)
    }

    const packAEnabled = dbRows.get('pack_a')?.is_enabled ?? false
    if (packAEnabled) {
      for (const key of PACK_A_FEATURES) {
        subscribed[key] = true
        visible[key] = dbRows.get(key)?.is_visible ?? true
      }
    }
    const packBEnabled = dbRows.get('pack_b')?.is_enabled ?? false
    if (packBEnabled) {
      for (const key of PACK_B_FEATURES) {
        subscribed[key] = true
        visible[key] = dbRows.get(key)?.is_visible ?? true
      }
    }
    setCompanyFeatures(subscribed)
    setFeaturesState(visible)
    setFeaturesLoaded(true)
  }, [])

  const setFeatures = (f: Features) => {
    setFeaturesState(f)
  }

  return (
    <FeatureContext.Provider value={{ features, companyFeatures, dashboardStyle, setFeatures, loadCompanyFeatures, featuresLoaded }}>
      {children}
    </FeatureContext.Provider>
  )
}

export const useFeatures = () => useContext(FeatureContext)
