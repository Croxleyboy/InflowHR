export interface BillingAdjustment {
  id: string
  company_id: string
  year: number
  month: number
  feature_key: string
  display_name: string
  adjustment_type: 'pro_rata_charge' | 'grace_reversal'
  activation_date: string | null
  days_charged: number | null
  days_in_month: number | null
  price_per_user: number
  employee_count: number
  line_amount: number
  created_at: string
}

export interface CompanyFeatureWithBilling {
  id: string
  company_id: string
  feature_key: string
  is_enabled: boolean
  custom_price: number | null
  activated_at: string | null
  deactivated_at: string | null
  grace_period_ends_at: string | null
  cancellation_scheduled: boolean
  cancellation_effective_date: string | null
  created_at: string
}

export interface FeatureChangeLog {
  id: string
  company_id: string
  feature_key: string
  action: 'enabled' | 'disabled' | 'grace_cancelled' | 'scheduled_cancel' | 'rollover_disabled'
  changed_by: string | null
  changed_at: string
  effective_price: number | null
  employee_count: number | null
  notes: string | null
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function getEndOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

export function calculateProRata(
  activationDay: number,
  daysInMonth: number,
  pricePerUser: number,
  employeeCount: number
): { days: number; amount: number } {
  const daysRemaining = daysInMonth - activationDay + 1
  const amount = Math.round(((daysRemaining / daysInMonth) * pricePerUser * employeeCount) * 100) / 100
  return { days: daysRemaining, amount }
}

export function isWithinGracePeriod(activatedAt: string | null, graceDays = 7): boolean {
  if (!activatedAt) return false
  const activated = new Date(activatedAt)
  const graceEnd = new Date(activated.getTime() + graceDays * 24 * 60 * 60 * 1000)
  return new Date() < graceEnd
}

export function gracePeriodRemaining(activatedAt: string | null, graceDays = 7): number {
  if (!activatedAt) return 0
  const activated = new Date(activatedAt)
  const graceEnd = new Date(activated.getTime() + graceDays * 24 * 60 * 60 * 1000)
  const remaining = graceEnd.getTime() - Date.now()
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)))
}

export function formatUKDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
