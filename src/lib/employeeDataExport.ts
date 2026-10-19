import * as XLSX from 'xlsx'
import JSZip from 'jszip'

interface ExportData {
  export_metadata: Record<string, unknown>
  employee: Record<string, unknown>
  [key: string]: unknown
}

const CATEGORY_LABELS: Record<string, string> = {
  employee: 'Personal Details',
  leave_requests: 'Leave Requests',
  leave_balances: 'Leave Balances',
  expense_claims: 'Expense Claims',
  expense_line_items: 'Expense Line Items',
  payslips: 'Payslips',
  kudos_given: 'Kudos Given',
  kudos_received: 'Kudos Received',
  timesheets: 'Timesheets',
  benefit_enrollments: 'Benefit Enrolments',
  shift_assignments: 'Shift Assignments',
  performance_reviews: 'Performance Reviews',
  space_bookings: 'Space Bookings',
  legal_timesheet_entries: 'Legal Timesheet Entries',
  one_to_one_meetings: 'One-to-One Meetings',
  hr_tickets: 'HR Tickets',
  onboarding: 'Onboarding',
  notifications: 'Notifications',
}

const DATE_COLUMNS = ['created_at', 'updated_at', 'start_date', 'end_date', 'date', 'pay_date', 'meeting_date', 'enrolled_at', 'issue_date', 'expiry_date']

function formatDateValue(val: unknown): string | unknown {
  if (typeof val !== 'string') return val
  const iso = /^\d{4}-\d{2}-\d{2}(T|\s)/.test(val)
  if (!iso) return val
  const d = new Date(val)
  if (isNaN(d.getTime())) return val
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function sanitiseForExcel(val: unknown): string | number | boolean | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'boolean') return val
  if (typeof val === 'number') return val
  const s = String(val)
  if (s.startsWith('=') || s.startsWith('+') || s.startsWith('-') || s.startsWith('@')) return "'" + s
  return s
}

function buildWorkbook(sheetName: string, rows: Record<string, unknown>[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  if (rows.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['No data']]), sheetName.slice(0, 31))
    return wb
  }

  const cols = Object.keys(rows[0])
  const headerRow = cols.map(c => CATEGORY_LABELS[c] || c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))
  const dataRows = rows.map(row =>
    cols.map(c => {
      const val = row[c]
      if (DATE_COLUMNS.includes(c)) return formatDateValue(val)
      if (typeof val === 'object' && val !== null) return JSON.stringify(val)
      return sanitiseForExcel(val)
    })
  )

  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows])
  const colWidths = cols.map((_c, i) => {
    const maxLen = Math.max(headerRow[i].length, ...dataRows.map(r => String(r[i] ?? '').length))
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) }
  })
  ws['!cols'] = colWidths

  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  return wb
}

export function getExportCategories(data: ExportData): { key: string; label: string; count: number }[] {
  const categories: { key: string; label: string; count: number }[] = []
  if (data.employee) {
    categories.push({ key: 'employee', label: 'Personal Details', count: 1 })
  }
  for (const [key, val] of Object.entries(data)) {
    if (key === 'export_metadata' || key === 'employee') continue
    if (Array.isArray(val)) {
      categories.push({
        key,
        label: CATEGORY_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        count: val.length,
      })
    }
  }
  return categories
}

export function getDateRange(data: ExportData): { earliest: string; latest: string } {
  let earliest = new Date()
  let latest = new Date(0)

  for (const [key, val] of Object.entries(data)) {
    if (key === 'export_metadata') continue
    const rows = key === 'employee' ? [val] : (Array.isArray(val) ? val : [])
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      for (const dc of DATE_COLUMNS) {
        const v = (row as Record<string, unknown>)[dc]
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
          const d = new Date(v)
          if (!isNaN(d.getTime())) {
            if (d < earliest) earliest = d
            if (d > latest) latest = d
          }
        }
      }
    }
  }

  if (latest.getTime() === 0) latest = new Date()
  return {
    earliest: earliest.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    latest: latest.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
  }
}

export async function buildEmployeeExportZip(data: ExportData, employeeName: string): Promise<Blob> {
  const zip = new JSZip()

  if (data.employee) {
    const wb = buildWorkbook('Personal Details', [data.employee as Record<string, unknown>])
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    zip.file('Personal_Details.xlsx', buf)
  }

  for (const [key, val] of Object.entries(data)) {
    if (key === 'export_metadata' || key === 'employee') continue
    if (!Array.isArray(val) || val.length === 0) continue
    const label = CATEGORY_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    const filename = label.replace(/\s+/g, '_') + '.xlsx'
    const wb = buildWorkbook(label, val as Record<string, unknown>[])
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    zip.file(filename, buf)
  }

  const metadata = {
    format: 'InflowHR Employee Data Export v2',
    exported_at: new Date().toISOString(),
    employee_name: employeeName,
    gdpr_article: 'Art. 15/20 — Right of access / Right to data portability',
    categories: getExportCategories(data).map(c => ({ name: c.label, records: c.count })),
  }
  zip.file('export_metadata.json', JSON.stringify(metadata, null, 2))

  return zip.generateAsync({ type: 'blob' })
}

export async function generateLeaverExport(
  data: ExportData,
  employeeName: string,
  leavingDate: string | null,
  leavingReason: string | null
): Promise<Blob> {
  const zip = new JSZip()

  if (data.employee) {
    const wb = buildWorkbook('Personal Details', [data.employee as Record<string, unknown>])
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    zip.file('Personal_Details.xlsx', buf)
  }

  for (const [key, val] of Object.entries(data)) {
    if (key === 'export_metadata' || key === 'employee') continue
    if (!Array.isArray(val) || val.length === 0) continue
    const label = CATEGORY_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    const filename = label.replace(/\s+/g, '_') + '.xlsx'
    const wb = buildWorkbook(label, val as Record<string, unknown>[])
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    zip.file(filename, buf)
  }

  const categories = getExportCategories(data)
  const metadata = {
    format: 'InflowHR Leaver Data Export v1',
    exported_at: new Date().toISOString(),
    employee_name: employeeName,
    leaving_date: leavingDate,
    leaving_reason: leavingReason,
    gdpr_article: 'Art. 17 GDPR — Right to erasure / Leaver data pack',
    retention_note: 'This data pack is provided as part of the offboarding process. The employer (data controller) is responsible for the data once exported. All data within InflowHR will be permanently deleted after the retention period.',
    categories: categories.map(c => ({ name: c.label, records: c.count })),
    total_records: categories.reduce((sum, c) => sum + c.count, 0),
  }
  zip.file('export_metadata.json', JSON.stringify(metadata, null, 2))

  return zip.generateAsync({ type: 'blob' })
}
