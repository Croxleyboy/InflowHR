import { describe, it, expect } from 'vitest'
import { countWorkingDays } from './workingDays'

describe('countWorkingDays', () => {
  it('counts Mon-Fri as 5 working days in a normal week', () => {
    // 2026-03-16 is Monday, 2026-03-20 is Friday
    expect(countWorkingDays('2026-03-16', '2026-03-20', false)).toBe(5)
  })

  it('excludes weekends', () => {
    // Full week Mon-Sun: should be 5 working days
    expect(countWorkingDays('2026-03-16', '2026-03-22', false)).toBe(5)
  })

  it('includes weekends when weekendsAsWorkdays is true', () => {
    // Full week Mon-Sun: 7 days if weekends count
    expect(countWorkingDays('2026-03-16', '2026-03-22', true)).toBe(7)
  })

  it('excludes UK bank holidays', () => {
    // 2026-12-25 is Christmas (Friday), 2026-12-28 is Boxing Day (Monday substitute)
    // Week of 21-27 Dec 2026: Mon-Fri = 5, minus Christmas = 4
    expect(countWorkingDays('2026-12-21', '2026-12-27', false)).toBe(4)
  })

  it('excludes bank holidays even when weekends are working days', () => {
    // Christmas day should still be excluded
    expect(countWorkingDays('2026-12-25', '2026-12-25', true)).toBe(0)
  })

  it('returns 0 when end is before start', () => {
    expect(countWorkingDays('2026-03-20', '2026-03-16', false)).toBe(0)
  })

  it('counts a single working day', () => {
    // 2026-03-16 is Monday
    expect(countWorkingDays('2026-03-16', '2026-03-16', false)).toBe(1)
  })

  it('returns 0 for a single weekend day', () => {
    // 2026-03-21 is Saturday
    expect(countWorkingDays('2026-03-21', '2026-03-21', false)).toBe(0)
  })

  it('handles Easter bank holidays (2026)', () => {
    // Good Friday 2026-04-03, Easter Monday 2026-04-06
    // Week of 2026-03-30 to 2026-04-03: Mon-Thu = 4 working, Fri = bank holiday
    expect(countWorkingDays('2026-03-30', '2026-04-03', false)).toBe(4)
  })

  it('handles New Year bank holiday', () => {
    // 2026-01-01 is Thursday (bank holiday)
    expect(countWorkingDays('2026-01-01', '2026-01-01', false)).toBe(0)
  })

  it('spans across years correctly', () => {
    // 2025-12-29 (Mon) to 2026-01-02 (Fri) = 5 weekdays
    // minus 2025-12-25 (Thu already past), 2025-12-26 (Fri already past)
    // actual range: Mon 29, Tue 30, Wed 31, Thu 1 Jan (bank hol), Fri 2 Jan
    // = 3 working days (29, 30, 31) + 0 (1 Jan holiday) + 1 (2 Jan) = 4
    expect(countWorkingDays('2025-12-29', '2026-01-02', false)).toBe(4)
  })
})
