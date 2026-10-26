import { describe, it, expect } from 'vitest'
import { calculateLeaverFinancials, type LeaverCalcInput } from './leaverCalculator'

function makeInput(overrides: Partial<LeaverCalcInput> = {}): LeaverCalcInput {
  return {
    employeeName: 'Jane Smith',
    employeeId: 'emp-001',
    startDate: '2023-01-09',
    noticeGivenBy: 'employee',
    noticeGivenDate: '2026-06-01',
    noticePeriod: '1 month',
    agreedLeavingDate: null,
    daysPerWeek: 5,
    hoursPerWeek: 37.5,
    payType: 'salaried',
    annualSalary: 35000,
    hourlyRate: null,
    annualEntitlement: 25,
    bankHolidayTreatment: 'included',
    bankHolidaysInYear: 8,
    leaveYearStart: '2026-01-01',
    carryOver: 2,
    leaveTaken: 8,
    leaveBooked: [],
    payoutPolicy: 'pay_out',
    clawbackClause: false,
    employerPensionRate: 3,
    ...overrides,
  }
}

describe('calculateLeaverFinancials', () => {
  describe('notice period calculation', () => {
    it('uses agreed leaving date when provided', () => {
      const result = calculateLeaverFinancials(makeInput({
        agreedLeavingDate: '2026-07-31',
      }))
      expect(result.leavingDate).toBe('2026-07-31')
      expect(result.noticeBasis).toBe('agreed')
    })

    it('calculates contractual notice for 1 month', () => {
      const result = calculateLeaverFinancials(makeInput({
        noticePeriod: '1 month',
      }))
      expect(result.noticeBasis).toBe('contractual')
      expect(result.noticePeriodApplied).toContain('1 month')
    })

    it('calculates contractual notice for 3 months', () => {
      const result = calculateLeaverFinancials(makeInput({
        noticePeriod: '3 months',
      }))
      expect(result.noticeBasis).toBe('contractual')
      expect(result.noticePeriodApplied).toContain('3 months')
    })

    it('uses statutory minimum when no contractual notice', () => {
      const result = calculateLeaverFinancials(makeInput({
        noticePeriod: null,
      }))
      expect(result.noticeBasis).toBe('statutory')
      expect(result.noticePeriodApplied).toContain('statutory')
    })

    it('uses statutory when it exceeds contractual (employer, long service)', () => {
      const result = calculateLeaverFinancials(makeInput({
        startDate: '2014-01-01',
        noticeGivenBy: 'employer',
        noticePeriod: '4 weeks',
      }))
      expect(result.noticeBasis).toBe('statutory')
      expect(result.flags.some(f => f.includes('Statutory notice'))).toBe(true)
    })

    it('employee notice is always 1 week statutory', () => {
      const result = calculateLeaverFinancials(makeInput({
        startDate: '2014-01-01',
        noticeGivenBy: 'employee',
        noticePeriod: null,
      }))
      expect(result.noticePeriodApplied).toContain('1 week')
    })
  })

  describe('leave accrual and balance', () => {
    it('calculates pro-rata accrual', () => {
      const result = calculateLeaverFinancials(makeInput())
      expect(result.accruedDays).toBeGreaterThan(0)
      expect(result.accruedDays).toBeLessThanOrEqual(result.fullYearEntitlement)
    })

    it('includes carry-over in total available', () => {
      const result = calculateLeaverFinancials(makeInput({ carryOver: 5 }))
      expect(result.totalAvailable).toBe(result.accruedDays + 5)
      expect(result.carryOverDays).toBe(5)
    })

    it('adds bank holidays to entitlement when treatment is additional', () => {
      const result = calculateLeaverFinancials(makeInput({
        bankHolidayTreatment: 'additional',
        annualEntitlement: 25,
        bankHolidaysInYear: 8,
      }))
      expect(result.fullYearEntitlement).toBe(33)
    })

    it('uses standard entitlement when bank holidays are included (above statutory min)', () => {
      const result = calculateLeaverFinancials(makeInput({
        bankHolidayTreatment: 'included',
        annualEntitlement: 30,
      }))
      expect(result.fullYearEntitlement).toBe(30)
    })

    it('enforces statutory minimum entitlement', () => {
      const result = calculateLeaverFinancials(makeInput({
        annualEntitlement: 10,
        daysPerWeek: 5,
      }))
      expect(result.statutoryCheck).toBe('fail')
      expect(result.fullYearEntitlement).toBe(28)
      expect(result.flags.some(f => f.includes('statutory minimum'))).toBe(true)
    })
  })

  describe('balance status', () => {
    it('shows owed when leave balance is positive', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveTaken: 0,
        carryOver: 0,
      }))
      expect(result.balanceStatus).toBe('owed')
      expect(result.balanceDays).toBeGreaterThan(0)
    })

    it('shows overtaken when leave exceeds accrual', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveTaken: 30,
        carryOver: 0,
      }))
      expect(result.balanceStatus).toBe('overtaken')
      expect(result.balanceDays).toBeLessThan(0)
    })
  })

  describe('financial calculations', () => {
    it('calculates day rate from annual salary', () => {
      const result = calculateLeaverFinancials(makeInput({
        annualSalary: 26000,
        daysPerWeek: 5,
      }))
      expect(result.dayRate).toBe(100)
    })

    it('calculates day rate from hourly rate', () => {
      const result = calculateLeaverFinancials(makeInput({
        payType: 'hourly',
        annualSalary: null,
        hourlyRate: 15,
        hoursPerWeek: 37.5,
        daysPerWeek: 5,
      }))
      expect(result.dayRate).toBe(112.5)
    })

    it('calculates gross payout for owed balance', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveTaken: 0,
        carryOver: 0,
      }))
      if (result.balanceStatus === 'owed') {
        expect(result.grossPayout).toBeGreaterThan(0)
        expect(result.grossPayout).toBe(
          parseFloat((result.balanceDays * result.dayRate).toFixed(2))
        )
      }
    })

    it('calculates employer NI at 13.8%', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveTaken: 0,
        carryOver: 0,
      }))
      if (result.grossPayout > 0) {
        expect(result.employerNI).toBe(
          parseFloat((result.grossPayout * 0.138).toFixed(2))
        )
      }
    })

    it('calculates employer pension contribution', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveTaken: 0,
        carryOver: 0,
        employerPensionRate: 5,
      }))
      if (result.grossPayout > 0) {
        expect(result.employerPension).toBe(
          parseFloat((result.grossPayout * 0.05).toFixed(2))
        )
      }
    })

    it('calculates total employer cost', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveTaken: 0,
        carryOver: 0,
      }))
      if (result.grossPayout > 0) {
        expect(result.totalEmployerCost).toBe(
          parseFloat((result.grossPayout + result.employerNI + result.employerPension).toFixed(2))
        )
      }
    })

    it('shows zero payout when salary missing', () => {
      const result = calculateLeaverFinancials(makeInput({
        annualSalary: null,
      }))
      expect(result.dayRate).toBe(0)
      expect(result.grossPayout).toBe(0)
      expect(result.flags.some(f => f.includes('No annual salary'))).toBe(true)
    })
  })

  describe('clawback', () => {
    it('calculates clawback value when overtaken', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveTaken: 30,
        carryOver: 0,
      }))
      expect(result.balanceStatus).toBe('overtaken')
      expect(result.clawbackValue).toBeGreaterThan(0)
    })

    it('permits clawback when clause exists', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveTaken: 30,
        carryOver: 0,
        clawbackClause: true,
      }))
      expect(result.clawbackPermitted).toBe('yes')
    })

    it('flags check_contract when no clawback clause', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveTaken: 30,
        carryOver: 0,
        clawbackClause: false,
      }))
      expect(result.clawbackPermitted).toBe('check_contract')
      expect(result.flags.some(f => f.includes('clawback clause'))).toBe(true)
    })
  })

  describe('leave bookings', () => {
    it('identifies bookings to cancel after leaving date', () => {
      const result = calculateLeaverFinancials(makeInput({
        agreedLeavingDate: '2026-07-31',
        leaveBooked: [
          { startDate: '2026-08-10', endDate: '2026-08-14', days: 5 },
        ],
      }))
      expect(result.leaveToCancel).toHaveLength(1)
      expect(result.leaveToCancel[0]).toContain('5 days')
    })

    it('counts bookings before leaving date as used', () => {
      const result = calculateLeaverFinancials(makeInput({
        agreedLeavingDate: '2026-07-31',
        leaveBooked: [
          { startDate: '2026-07-01', endDate: '2026-07-03', days: 3 },
        ],
      }))
      expect(result.leaveBookedBeforeLeavingDays).toBe(3)
    })
  })

  describe('leave year boundaries', () => {
    it('sets correct leave year end', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveYearStart: '2026-04-01',
      }))
      expect(result.leaveYearStart).toBe('2026-04-01')
      expect(result.leaveYearEnd).toBe('2027-03-31')
    })

    it('handles Jan-Dec leave year', () => {
      const result = calculateLeaverFinancials(makeInput({
        leaveYearStart: '2026-01-01',
      }))
      expect(result.leaveYearEnd).toBe('2026-12-31')
    })
  })

  it('always includes the legal disclaimer flag', () => {
    const result = calculateLeaverFinancials(makeInput())
    expect(result.flags.some(f => f.includes('not legal advice'))).toBe(true)
  })
})
