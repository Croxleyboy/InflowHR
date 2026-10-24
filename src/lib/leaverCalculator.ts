export interface LeaverCalcInput {
  employeeName: string
  employeeId: string
  startDate: string
  noticeGivenBy: 'employee' | 'employer'
  noticeGivenDate: string
  noticePeriod: string | null
  agreedLeavingDate: string | null
  daysPerWeek: number
  hoursPerWeek: number
  payType: 'salaried' | 'hourly'
  annualSalary: number | null
  hourlyRate: number | null
  annualEntitlement: number
  bankHolidayTreatment: 'included' | 'additional' | 'not_given'
  bankHolidaysInYear: number
  leaveYearStart: string
  carryOver: number
  leaveTaken: number
  leaveBooked: { startDate: string; endDate: string; days: number }[]
  payoutPolicy: 'pay_out' | 'must_take' | 'company_decides' | 'mixed'
  clawbackClause: boolean
  employerPensionRate: number
}

export interface LeaverCalcResult {
  leavingDate: string
  noticeBasis: 'contractual' | 'statutory' | 'agreed'
  noticePeriodApplied: string
  leaveYearStart: string
  leaveYearEnd: string
  fullYearEntitlement: number
  statutoryMinimum: number
  statutoryCheck: 'pass' | 'fail'
  daysElapsed: number
  daysInYear: number
  accruedDays: number
  carryOverDays: number
  totalAvailable: number
  leaveTakenDays: number
  leaveBookedBeforeLeavingDays: number
  bankHolidaysUsed: number
  totalUsed: number
  leaveToCancel: string[]
  balanceUnrounded: number
  balanceDays: number
  balanceHours: number
  balanceStatus: 'owed' | 'overtaken' | 'nil'
  dayRate: number
  grossPayout: number
  employerNI: number
  employerPension: number
  totalEmployerCost: number
  clawbackValue: number
  clawbackPermitted: 'yes' | 'no' | 'check_contract'
  flags: string[]
  calculatedAt: string
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function addMonths(d: Date, months: number): Date {
  const result = new Date(d)
  const targetMonth = result.getMonth() + months
  result.setMonth(targetMonth)
  if (result.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setDate(0)
  }
  return result
}

function addWeeks(d: Date, weeks: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + weeks * 7)
  return result
}

function parseNoticePeriod(notice: string): { unit: 'weeks' | 'months'; value: number } | null {
  if (!notice) return null
  const lower = notice.toLowerCase().trim()
  const match = lower.match(/^(\d+)\s*(week|month|wk|mo)s?$/)
  if (match) {
    const value = parseInt(match[1], 10)
    const unit = match[2].startsWith('mo') ? 'months' : 'weeks'
    return { unit, value }
  }
  return null
}

function completeYearsOfService(startDate: Date, asOf: Date): number {
  let years = asOf.getFullYear() - startDate.getFullYear()
  const anniversary = new Date(startDate)
  anniversary.setFullYear(asOf.getFullYear())
  if (anniversary > asOf) years--
  return Math.max(0, years)
}

function statutoryNoticeWeeks(givenBy: 'employee' | 'employer', yearsService: number, employedAtLeastOneMonth: boolean): number {
  if (!employedAtLeastOneMonth) return 0
  if (givenBy === 'employee') return 1
  if (yearsService < 2) return 1
  return Math.min(yearsService, 12)
}

function roundToHalfDay(value: number): number {
  return Math.ceil(value * 2) / 2
}

export function calculateLeaverFinancials(input: LeaverCalcInput): LeaverCalcResult {
  const flags: string[] = []
  const today = new Date()
  const startDate = parseDate(input.startDate)
  const noticeGivenDate = parseDate(input.noticeGivenDate)

  if (input.payType === 'salaried' && !input.annualSalary) {
    flags.push('WARNING: No annual salary recorded for this employee. All cost figures will show as £0.00. Update the employee\'s salary in their profile to get accurate costs.')
  } else if (input.payType === 'hourly' && !input.hourlyRate) {
    flags.push('WARNING: No hourly rate recorded for this employee. All cost figures will show as £0.00. Update the employee\'s hourly rate in their profile to get accurate costs.')
  }
  if (!input.noticePeriod && !input.agreedLeavingDate) {
    flags.push('WARNING: No contractual notice period recorded and no agreed leaving date set. Statutory minimum notice has been used, which may not reflect the actual contract.')
  }
  if (input.annualEntitlement === 28 && input.payType === 'salaried') {
    flags.push('NOTE: Using default leave allowance of 28 days. If the employee has a different entitlement, update their leave allowance for an accurate calculation.')
  }
  if (!input.hoursPerWeek || input.hoursPerWeek <= 0) {
    flags.push('WARNING: No weekly hours recorded. Hours-based figures may be inaccurate.')
  }

  // STEP 1: Leaving date
  let leavingDate: Date
  let noticeBasis: 'contractual' | 'statutory' | 'agreed'
  let noticePeriodApplied: string

  if (input.agreedLeavingDate) {
    leavingDate = parseDate(input.agreedLeavingDate)
    noticeBasis = 'agreed'
    noticePeriodApplied = 'Agreed leaving date'
  } else {
    const noticeStartDate = new Date(noticeGivenDate)
    noticeStartDate.setDate(noticeStartDate.getDate() + 1)

    const employedMonths = daysBetween(startDate, noticeGivenDate) / 30.44
    const employedAtLeastOneMonth = employedMonths >= 1
    const yearsService = completeYearsOfService(startDate, noticeGivenDate)
    const statWeeks = statutoryNoticeWeeks(input.noticeGivenBy, yearsService, employedAtLeastOneMonth)

    const parsed = parseNoticePeriod(input.noticePeriod || '')
    let contractualEnd: Date | null = null
    let contractualDesc = ''

    if (parsed) {
      if (parsed.unit === 'months') {
        contractualEnd = addMonths(noticeStartDate, parsed.value)
        contractualEnd.setDate(contractualEnd.getDate() - 1)
        contractualDesc = `${parsed.value} month${parsed.value !== 1 ? 's' : ''}`
      } else {
        contractualEnd = addWeeks(noticeStartDate, parsed.value)
        contractualEnd.setDate(contractualEnd.getDate() - 1)
        contractualDesc = `${parsed.value} week${parsed.value !== 1 ? 's' : ''}`
      }
    }

    const statutoryEnd = addWeeks(noticeStartDate, statWeeks)
    statutoryEnd.setDate(statutoryEnd.getDate() - 1)

    if (contractualEnd && contractualEnd >= statutoryEnd) {
      leavingDate = contractualEnd
      noticeBasis = 'contractual'
      noticePeriodApplied = contractualDesc + ' (contractual)'
    } else if (contractualEnd) {
      leavingDate = statutoryEnd
      noticeBasis = 'statutory'
      noticePeriodApplied = `${statWeeks} week${statWeeks !== 1 ? 's' : ''} (statutory — exceeds contractual ${contractualDesc})`
      flags.push(`Statutory notice (${statWeeks} weeks) is longer than contractual (${contractualDesc}). Statutory minimum used.`)
    } else {
      leavingDate = statutoryEnd
      noticeBasis = 'statutory'
      noticePeriodApplied = `${statWeeks} week${statWeeks !== 1 ? 's' : ''} (statutory — no contractual notice recorded)`
      flags.push('No contractual notice period recorded; statutory minimum used.')
    }
  }

  // STEP 2: Full-year entitlement
  const daysPerWeek = input.daysPerWeek || 5
  let fullYearEntitlement = input.annualEntitlement
  if (input.bankHolidayTreatment === 'additional') {
    fullYearEntitlement += input.bankHolidaysInYear
  }
  const statutoryMinimum = Math.min(5.6 * daysPerWeek, 28)
  const statutoryCheck = fullYearEntitlement >= statutoryMinimum ? 'pass' : 'fail'
  if (statutoryCheck === 'fail') {
    flags.push(`Full-year entitlement (${fullYearEntitlement} days) is below the statutory minimum of ${statutoryMinimum} days. Using statutory minimum.`)
    fullYearEntitlement = statutoryMinimum
  }

  // STEP 3: Pro-rata accrual to leaving date
  const leaveYearStartDate = parseDate(input.leaveYearStart)
  const leaveYearEndDate = new Date(leaveYearStartDate)
  leaveYearEndDate.setFullYear(leaveYearEndDate.getFullYear() + 1)
  leaveYearEndDate.setDate(leaveYearEndDate.getDate() - 1)

  const leaveYearContains29Feb = (() => {
    const y1 = leaveYearStartDate.getFullYear()
    const y2 = leaveYearEndDate.getFullYear()
    for (let y = y1; y <= y2; y++) {
      if (!isLeapYear(y)) continue
      const feb29 = new Date(y, 1, 29)
      if (feb29 >= leaveYearStartDate && feb29 <= leaveYearEndDate) return true
    }
    return false
  })()
  const daysInYear = leaveYearContains29Feb ? 366 : 365

  const accrualStartDate = startDate > leaveYearStartDate ? startDate : leaveYearStartDate
  if (startDate > leaveYearStartDate) {
    flags.push('Employee started during this leave year; accrual runs from start date, not leave year start.')
  }

  const daysElapsed = daysBetween(accrualStartDate, leavingDate) + 1
  const accruedDays = parseFloat(((fullYearEntitlement * daysElapsed) / daysInYear).toFixed(4))
  const totalAvailable = accruedDays + input.carryOver

  // STEP 4: Leave used
  let leaveBookedBeforeLeavingDays = 0
  const leaveToCancel: string[] = []
  for (const booking of input.leaveBooked) {
    const bookStart = parseDate(booking.startDate)
    const bookEnd = parseDate(booking.endDate)
    if (bookStart > leavingDate) {
      leaveToCancel.push(`${booking.startDate} to ${booking.endDate} (${booking.days} days)`)
    } else if (bookEnd <= leavingDate) {
      leaveBookedBeforeLeavingDays += booking.days
    } else {
      const daysBeforeLeaving = daysBetween(bookStart, leavingDate) + 1
      const proportionalDays = Math.min(booking.days, Math.round((daysBeforeLeaving / (daysBetween(bookStart, bookEnd) + 1)) * booking.days * 10) / 10)
      leaveBookedBeforeLeavingDays += proportionalDays
      leaveToCancel.push(`Partial: ${toIso(new Date(leavingDate.getTime() + 86400000))} to ${booking.endDate}`)
    }
  }

  let bankHolidaysUsed = 0
  if (input.bankHolidayTreatment !== 'not_given') {
    const ukBankHolidayMonths = [0, 2, 3, 4, 7, 11]
    const bhStart = accrualStartDate
    const bhEnd = leavingDate
    const bhYear = bhStart.getFullYear()
    for (let y = bhYear; y <= leavingDate.getFullYear(); y++) {
      for (const m of ukBankHolidayMonths) {
        const bhDate = new Date(y, m, 1)
        if (bhDate >= bhStart && bhDate <= bhEnd) {
          bankHolidaysUsed++
        }
      }
    }
    bankHolidaysUsed = Math.min(bankHolidaysUsed, input.bankHolidaysInYear)
    flags.push(`Bank holidays used (${bankHolidaysUsed}) estimated from standard UK calendar. Verify against actual bank holiday dates for this leave year.`)
  }

  const totalUsed = input.leaveTaken + leaveBookedBeforeLeavingDays + bankHolidaysUsed

  // STEP 5: Balance
  const balanceUnrounded = parseFloat((totalAvailable - totalUsed).toFixed(4))
  const roundedBalance = roundToHalfDay(Math.abs(balanceUnrounded)) * (balanceUnrounded >= 0 ? 1 : -1)
  const balanceDays = parseFloat(roundedBalance.toFixed(2))
  const hoursPerDay = daysPerWeek > 0 ? input.hoursPerWeek / daysPerWeek : 0
  const balanceHours = parseFloat((balanceDays * hoursPerDay).toFixed(2))

  let balanceStatus: 'owed' | 'overtaken' | 'nil'
  if (balanceDays > 0) balanceStatus = 'owed'
  else if (balanceDays < 0) balanceStatus = 'overtaken'
  else balanceStatus = 'nil'

  // STEP 6: Outcome and cost
  let dayRate = 0
  if (input.payType === 'salaried' && input.annualSalary) {
    dayRate = parseFloat((input.annualSalary / (52 * daysPerWeek)).toFixed(2))
  } else if (input.payType === 'hourly' && input.hourlyRate) {
    dayRate = parseFloat((input.hourlyRate * hoursPerDay).toFixed(2))
  }

  let grossPayout = 0
  let employerNI = 0
  let employerPension = 0
  let totalEmployerCost = 0
  let clawbackValue = 0
  let clawbackPermitted: 'yes' | 'no' | 'check_contract' = 'check_contract'

  if (balanceStatus === 'owed') {
    grossPayout = parseFloat((balanceDays * dayRate).toFixed(2))
    employerNI = parseFloat((grossPayout * 0.138).toFixed(2))
    flags.push('Employer NI calculated at 13.8% assuming employee is above secondary threshold. Verify for current tax year.')
    if (input.employerPensionRate > 0) {
      employerPension = parseFloat((grossPayout * (input.employerPensionRate / 100)).toFixed(2))
    }
    totalEmployerCost = parseFloat((grossPayout + employerNI + employerPension).toFixed(2))
  } else if (balanceStatus === 'overtaken') {
    clawbackValue = parseFloat((Math.abs(balanceDays) * dayRate).toFixed(2))
    clawbackPermitted = input.clawbackClause ? 'yes' : 'check_contract'
    if (!input.clawbackClause) {
      flags.push('No clawback clause recorded. Deduction from final pay should NOT be made without checking the employment contract — risk of unlawful deduction from wages claim.')
    }
    flags.push('Any deduction must not take pay below National Minimum Wage for the final pay period.')
  }

  if (input.payoutPolicy === 'must_take') {
    const workingDaysLeft = daysBetween(today, leavingDate)
    const approxWorkingDays = Math.round(workingDaysLeft * (daysPerWeek / 7))
    if (balanceDays > 0 && balanceDays > approxWorkingDays) {
      flags.push(`Policy requires leave to be taken during notice, but only ~${approxWorkingDays} working days remain before leaving date. ${balanceDays} days cannot all be taken — remainder must be paid.`)
    }
    flags.push('Under Working Time Regulations, employer must give notice of at least TWICE the length of leave required (e.g. 3 days\' notice for 1.5 days off).')
  }

  flags.push('This is a calculation aid, not legal advice. Check the employment contract before final pay is processed.')

  return {
    leavingDate: toIso(leavingDate),
    noticeBasis,
    noticePeriodApplied,
    leaveYearStart: toIso(leaveYearStartDate),
    leaveYearEnd: toIso(leaveYearEndDate),
    fullYearEntitlement: parseFloat(fullYearEntitlement.toFixed(2)),
    statutoryMinimum: parseFloat(statutoryMinimum.toFixed(2)),
    statutoryCheck,
    daysElapsed,
    daysInYear,
    accruedDays: parseFloat(accruedDays.toFixed(2)),
    carryOverDays: input.carryOver,
    totalAvailable: parseFloat(totalAvailable.toFixed(2)),
    leaveTakenDays: input.leaveTaken,
    leaveBookedBeforeLeavingDays: parseFloat(leaveBookedBeforeLeavingDays.toFixed(2)),
    bankHolidaysUsed,
    totalUsed: parseFloat(totalUsed.toFixed(2)),
    leaveToCancel,
    balanceUnrounded: parseFloat(balanceUnrounded.toFixed(4)),
    balanceDays,
    balanceHours,
    balanceStatus,
    dayRate,
    grossPayout,
    employerNI,
    employerPension,
    totalEmployerCost,
    clawbackValue,
    clawbackPermitted,
    flags,
    calculatedAt: new Date().toISOString(),
  }
}
