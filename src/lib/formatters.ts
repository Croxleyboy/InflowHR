const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', JPY: '¥', AUD: 'A$', CAD: 'C$', CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr', NZD: 'NZ$', ZAR: 'R', INR: '₹', SGD: 'S$', HKD: 'HK$',
}

export function currencySymbol(code: string = 'GBP'): string {
  return CURRENCY_SYMBOLS[code] || code + ' '
}

export function formatCurrency(amount: number, code: string = 'GBP'): string {
  return `${currencySymbol(code)}${amount.toFixed(2)}`
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export function formatDateFriendly(dateStr: string): string {
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

export function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const day = d.getDate()
  const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th'
  return `${days[d.getDay()]} ${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`
}

export function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${mins}`
}

export function formatTime24(timeStr: string): string {
  return timeStr.slice(0, 5)
}

export function formatTime12(time: string): string {
  if (!time) return ''
  const [hh, mm] = time.split(':').map(Number)
  const ampm = hh >= 12 ? 'pm' : 'am'
  const h = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return `${h}:${String(mm).padStart(2, '0')}${ampm}`
}

export function toLocalDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getFYYear(date: Date, fyStartMonth: number): number {
  return date.getMonth() + 1 >= fyStartMonth ? date.getFullYear() : date.getFullYear() - 1
}

export function getFYRange(fyStartMonth: number): { fyYear: number; fyStart: string; fyEnd: string } {
  const now = new Date()
  const fyYear = getFYYear(now, fyStartMonth)
  const fyStart = `${fyYear}-${String(fyStartMonth).padStart(2, '0')}-01`
  const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1
  const endYear = fyStartMonth === 1 ? fyYear : fyYear + 1
  const endDay = new Date(endYear, endMonth, 0).getDate()
  const fyEnd = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
  return { fyYear, fyStart, fyEnd }
}
