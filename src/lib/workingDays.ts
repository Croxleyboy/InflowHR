import { toLocalDateStr } from './formatters'

const UK_BANK_HOLIDAYS: Record<number, string[]> = {
  2024: [
    '2024-01-01', '2024-03-29', '2024-04-01', '2024-05-06',
    '2024-05-27', '2024-08-26', '2024-12-25', '2024-12-26',
  ],
  2025: [
    '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05',
    '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  ],
  2026: [
    '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04',
    '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  ],
  2027: [
    '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03',
    '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
  ],
  2028: [
    '2028-01-03', '2028-04-14', '2028-04-17', '2028-05-01',
    '2028-05-29', '2028-08-28', '2028-12-25', '2028-12-26',
  ],
  2029: [
    '2029-01-01', '2029-03-30', '2029-04-02', '2029-05-07',
    '2029-05-28', '2029-08-27', '2029-12-25', '2029-12-26',
  ],
  2030: [
    '2030-01-01', '2030-04-19', '2030-04-22', '2030-05-06',
    '2030-05-27', '2030-08-26', '2030-12-25', '2030-12-26',
  ],
}

function getHolidaySet(startYear: number, endYear: number): Set<string> {
  const set = new Set<string>()
  for (let y = startYear; y <= endYear; y++) {
    const list = UK_BANK_HOLIDAYS[y]
    if (list) list.forEach(d => set.add(d))
  }
  return set
}

export function countWorkingDays(
  startDate: string,
  endDate: string,
  weekendsAsWorkdays: boolean
): number {
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  if (end < start) return 0

  const holidays = getHolidaySet(start.getFullYear(), end.getFullYear())
  let count = 0
  const current = new Date(start)

  while (current <= end) {
    const day = current.getDay()
    const iso = toLocalDateStr(current)
    const isWeekend = day === 0 || day === 6
    const isHoliday = holidays.has(iso)

    if (!isHoliday && (weekendsAsWorkdays || !isWeekend)) {
      count++
    }
    current.setDate(current.getDate() + 1)
  }

  return count
}
