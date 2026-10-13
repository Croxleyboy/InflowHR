import { supabase } from './supabase'
import { currencySymbol } from './formatters'

interface DefaultOption {
  option_key: string
  icon: string
  title: string
  description: string
  is_enabled: boolean
  sort_order: number
}

interface DefaultBenefit {
  benefit_key: string
  title: string
  description: string
  icon: string
  color: string
  intro: string
  eligibility: string
  cost_description: string
  monthly_cost: number
  lock_period: 'none' | 'month' | 'year'
  is_enabled: boolean
  sort_order: number
  options: DefaultOption[]
}

export const DEFAULT_BENEFITS: DefaultBenefit[] = [
  {
    benefit_key: 'vacation', title: 'Vacation / Salary Sacrifice', description: 'Flexible leave options and salary sacrifice schemes',
    icon: '📦', color: '#7b1fa2', intro: 'Take control of your work-life balance with our flexible vacation and salary sacrifice options.',
    eligibility: 'Available to all permanent employees who have completed their probation period (typically 6 months).', cost_description: 'Costs vary by option — see individual items below.',
    monthly_cost: 0, lock_period: 'none', is_enabled: true, sort_order: 0,
    options: [
      { option_key: 'buy_leave', icon: '🛒', title: 'Buy Additional Leave', description: 'Purchase up to 5 extra days annual leave per year via salary sacrifice', is_enabled: true, sort_order: 0 },
      { option_key: 'sell_leave', icon: '💷', title: 'Sell Leave', description: 'Sell up to 3 days unused annual leave back for extra pay', is_enabled: true, sort_order: 1 },
      { option_key: 'carry_over', icon: '📦', title: 'Carry Over', description: 'Carry up to 5 unused days into the next holiday year', is_enabled: true, sort_order: 2 },
      { option_key: 'sabbatical', icon: '🌍', title: 'Sabbatical Programme', description: 'Apply for 1–3 months unpaid sabbatical after 3 years service', is_enabled: true, sort_order: 3 },
      { option_key: 'compressed_hours', icon: '⏰', title: 'Compressed Hours', description: 'Work your weekly hours across 4 days instead of 5', is_enabled: true, sort_order: 4 },
    ],
  },
  {
    benefit_key: 'health', title: 'Health Insurance', description: 'Comprehensive private medical cover for you and your family',
    icon: '🏥', color: '#e53935', intro: 'Comprehensive private medical insurance provided through our partnership with leading UK health insurers.',
    eligibility: 'Available to all permanent employees from day one. Family cover available after probation.', cost_description: `Employer-funded for individual cover. Family add-on: ${currencySymbol()}45/month via salary sacrifice.`,
    monthly_cost: 45, lock_period: 'year', is_enabled: true, sort_order: 1,
    options: [
      { option_key: 'hospital', icon: '🏥', title: 'Private Hospital Treatment', description: 'Access to private hospitals and specialists with no NHS waiting lists', is_enabled: true, sort_order: 0 },
      { option_key: 'gp', icon: '👨‍⚕️', title: '24/7 GP Access', description: 'Round-the-clock access to a GP via phone or video consultation', is_enabled: true, sort_order: 1 },
      { option_key: 'dental', icon: '🦷', title: 'Dental Cover', description: 'Routine and emergency dental treatment covered', is_enabled: true, sort_order: 2 },
      { option_key: 'optical', icon: '👁️', title: 'Optical Cover', description: 'Eye tests and contribution towards glasses or contact lenses', is_enabled: true, sort_order: 3 },
      { option_key: 'prescriptions', icon: '💊', title: 'Prescription Cover', description: 'Outpatient prescription costs fully covered', is_enabled: true, sort_order: 4 },
      { option_key: 'wellness', icon: '🏆', title: 'Wellness Programme', description: 'Access to gym discounts, mental health support and wellbeing resources', is_enabled: true, sort_order: 5 },
      { option_key: 'family', icon: '👨‍👩‍👧', title: 'Family Cover', description: 'Extend cover to partner and dependants at reduced rates', is_enabled: true, sort_order: 6 },
    ],
  },
  {
    benefit_key: 'car', title: 'Car Insurance', description: 'Discounted group car insurance through salary sacrifice',
    icon: '🚗', color: '#1565c0', intro: 'Take advantage of our corporate group car insurance scheme offering competitive rates and comprehensive cover.',
    eligibility: 'Available to all permanent employees after 3 months of service. Must hold a valid UK driving licence.', cost_description: `From ${currencySymbol()}35/month via salary sacrifice — exact rate based on vehicle and driving history.`,
    monthly_cost: 35, lock_period: 'year', is_enabled: true, sort_order: 2,
    options: [
      { option_key: 'comprehensive', icon: '🚗', title: 'Fully Comprehensive Cover', description: 'Full cover for damage, theft, third party and fire', is_enabled: true, sort_order: 0 },
      { option_key: 'breakdown', icon: '🛡️', title: 'Breakdown Assistance', description: 'Roadside recovery and home start included as standard', is_enabled: true, sort_order: 1 },
      { option_key: 'windscreen', icon: '🔧', title: 'Windscreen & Glass', description: 'Windscreen repair and replacement without affecting no-claims', is_enabled: true, sort_order: 2 },
      { option_key: 'discount', icon: '💰', title: 'Group Discount Rate', description: 'Up to 20% discount vs individual policies through group scheme', is_enabled: true, sort_order: 3 },
      { option_key: 'legal', icon: '⚖️', title: 'Legal Expenses Cover', description: `Motor legal protection up to ${currencySymbol()}100,000 included`, is_enabled: true, sort_order: 4 },
      { option_key: 'courtesy', icon: '🚙', title: 'Courtesy Car', description: 'Replacement vehicle provided while yours is being repaired', is_enabled: true, sort_order: 5 },
    ],
  },
  {
    benefit_key: 'cycle', title: 'Cycle to Work Scheme', description: 'Save on a new bike and accessories through salary sacrifice',
    icon: '🚲', color: '#43a047', intro: 'Save up to 42% on a new bicycle and cycling accessories through the government-backed Cycle to Work scheme.',
    eligibility: 'Open to all employees on PAYE. You must use the bike primarily for commuting to work.', cost_description: 'Tax-free salary sacrifice over 12 months. Typical saving: 32–42% vs retail.',
    monthly_cost: 48, lock_period: 'month', is_enabled: true, sort_order: 3,
    options: [
      { option_key: 'bike', icon: '🚲', title: 'Bicycle Purchase', description: `Any bike up to ${currencySymbol()}1,000 (standard) or ${currencySymbol()}5,000 (enhanced scheme)`, is_enabled: true, sort_order: 0 },
      { option_key: 'tax_free', icon: '💷', title: 'Tax-Free Saving', description: 'Save on Income Tax and National Insurance contributions', is_enabled: true, sort_order: 1 },
      { option_key: 'green', icon: '🌱', title: 'Eco-Friendly Commute', description: 'Reduce your carbon footprint and improve your health', is_enabled: true, sort_order: 2 },
      { option_key: 'accessories', icon: '🔄', title: 'Accessories Included', description: 'Helmets, locks, lights, panniers and clothing can be included', is_enabled: true, sort_order: 3 },
      { option_key: 'insurance', icon: '🛡️', title: 'Cycle Insurance', description: 'Theft and damage cover available as an add-on', is_enabled: true, sort_order: 4 },
      { option_key: 'maintenance', icon: '📋', title: 'Servicing Package', description: 'Optional annual service plan included in salary sacrifice', is_enabled: true, sort_order: 5 },
    ],
  },
]

export async function seedBenefitDefaults(companyId: string): Promise<void> {
  for (const def of DEFAULT_BENEFITS) {
    const { options, ...typeData } = def
    const { data: inserted } = await supabase
      .from('benefit_types')
      .insert({ ...typeData, company_id: companyId })
      .select('id')
      .single()
    if (inserted) {
      for (const opt of options) {
        await supabase.from('benefit_options').insert({
          ...opt,
          benefit_type_id: inserted.id,
          company_id: companyId,
        })
      }
    }
  }
}
