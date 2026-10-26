import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateFriendly,
  formatDateLong,
  formatDateDisplay,
  formatDateTime,
  formatTime12,
  toLocalDateStr,
  getFYYear,
  currencySymbol,
  formatCurrency,
} from './formatters'

describe('formatDate — UK DD/MM/YYYY', () => {
  it('formats ISO date string to DD/MM/YYYY', () => {
    expect(formatDate('2026-03-15')).toBe('15/03/2026')
  })

  it('formats date with timestamp', () => {
    expect(formatDate('2026-12-25T10:30:00')).toBe('25/12/2026')
  })

  it('handles single-digit day and month with zero padding', () => {
    expect(formatDate('2026-01-05')).toBe('05/01/2026')
  })

  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('')
  })

  it('returns empty string for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('')
  })

  it('handles leap year date', () => {
    expect(formatDate('2024-02-29')).toBe('29/02/2024')
  })

  it('handles year boundary', () => {
    expect(formatDate('2026-12-31')).toBe('31/12/2026')
  })

  it('never outputs US MM/DD/YYYY format', () => {
    const result = formatDate('2026-03-15')
    expect(result).not.toBe('03/15/2026')
    const [dd, mm] = result.split('/')
    expect(parseInt(dd)).toBe(15)
    expect(parseInt(mm)).toBe(3)
  })
})

describe('formatDateDisplay — simple split-based DD/MM/YYYY', () => {
  it('converts YYYY-MM-DD to DD/MM/YYYY', () => {
    expect(formatDateDisplay('2026-07-04')).toBe('04/07/2026')
  })

  it('preserves zero padding', () => {
    expect(formatDateDisplay('2026-01-01')).toBe('01/01/2026')
  })
})

describe('formatDateFriendly', () => {
  it('formats as day-of-week, date, month, year', () => {
    const result = formatDateFriendly('2026-03-15')
    expect(result).toBe('Sun, 15 Mar 2026')
  })
})

describe('formatDateLong', () => {
  it('includes ordinal suffix for 1st', () => {
    expect(formatDateLong('2026-03-01T00:00:00')).toContain('1st')
  })

  it('includes ordinal suffix for 2nd', () => {
    expect(formatDateLong('2026-03-02T00:00:00')).toContain('2nd')
  })

  it('includes ordinal suffix for 3rd', () => {
    expect(formatDateLong('2026-03-03T00:00:00')).toContain('3rd')
  })

  it('includes ordinal suffix for 4th', () => {
    expect(formatDateLong('2026-03-04T00:00:00')).toContain('4th')
  })

  it('includes ordinal suffix for 21st', () => {
    expect(formatDateLong('2026-03-21T00:00:00')).toContain('21st')
  })
})

describe('formatDateTime', () => {
  it('formats date and time as DD/MM/YYYY HH:MM', () => {
    const result = formatDateTime('2026-03-15T14:30:00')
    expect(result).toBe('15/03/2026 14:30')
  })

  it('pads single-digit hours and minutes', () => {
    const result = formatDateTime('2026-01-05T09:05:00')
    expect(result).toBe('05/01/2026 09:05')
  })
})

describe('formatTime12', () => {
  it('converts 24h to 12h with am/pm', () => {
    expect(formatTime12('14:30')).toBe('2:30pm')
    expect(formatTime12('09:00')).toBe('9:00am')
  })

  it('handles midnight', () => {
    expect(formatTime12('00:00')).toBe('12:00am')
  })

  it('handles noon', () => {
    expect(formatTime12('12:00')).toBe('12:00pm')
  })

  it('returns empty for empty input', () => {
    expect(formatTime12('')).toBe('')
  })
})

describe('toLocalDateStr', () => {
  it('formats Date to YYYY-MM-DD', () => {
    const d = new Date(2026, 2, 15)
    expect(toLocalDateStr(d)).toBe('2026-03-15')
  })

  it('pads single-digit months', () => {
    const d = new Date(2026, 0, 5)
    expect(toLocalDateStr(d)).toBe('2026-01-05')
  })
})

describe('getFYYear', () => {
  it('returns current year when date is after FY start (April)', () => {
    const date = new Date(2026, 5, 15) // June 2026
    expect(getFYYear(date, 4)).toBe(2026)
  })

  it('returns previous year when date is before FY start (April)', () => {
    const date = new Date(2026, 1, 15) // February 2026
    expect(getFYYear(date, 4)).toBe(2025)
  })

  it('returns current year when FY starts in January', () => {
    const date = new Date(2026, 5, 15)
    expect(getFYYear(date, 1)).toBe(2026)
  })
})

describe('currencySymbol', () => {
  it('returns £ for GBP', () => {
    expect(currencySymbol('GBP')).toBe('£')
  })

  it('defaults to GBP', () => {
    expect(currencySymbol()).toBe('£')
  })

  it('returns code + space for unknown currency', () => {
    expect(currencySymbol('XYZ')).toBe('XYZ ')
  })
})

describe('formatCurrency', () => {
  it('formats GBP with two decimal places', () => {
    expect(formatCurrency(1234.5)).toBe('£1234.50')
  })

  it('formats EUR', () => {
    expect(formatCurrency(99, 'EUR')).toBe('€99.00')
  })
})
