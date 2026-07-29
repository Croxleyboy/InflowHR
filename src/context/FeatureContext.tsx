import { createContext, useContext, useState, type ReactNode } from 'react'

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
}

interface FeatureContextType {
  features: Features
  setFeatures: (f: Features) => void
}

const FeatureContext = createContext<FeatureContextType>({
  features: defaultFeatures,
  setFeatures: () => {},
})

export function FeatureProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<Features>(() => {
    const saved = localStorage.getItem('inflowhr-features')
    return saved ? JSON.parse(saved) : defaultFeatures
  })

  const updateFeatures = (f: Features) => {
    setFeatures(f)
    localStorage.setItem('inflowhr-features', JSON.stringify(f))
  }

  return (
    <FeatureContext.Provider value={{ features, setFeatures: updateFeatures }}>
      {children}
    </FeatureContext.Provider>
  )
}

export const useFeatures = () => useContext(FeatureContext)
