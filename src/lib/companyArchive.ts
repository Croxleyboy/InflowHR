import { supabase } from './supabase'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface FYRange {
  start: string
  end: string
  label: string
  fyStartMonth: number
}

export async function getCompanyFY(companyId: string): Promise<FYRange> {
  const { data } = await supabase
    .from('companies')
    .select('fy_start_month')
    .eq('id', companyId)
    .single()
  const fyMonth = data?.fy_start_month ?? 4
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const fyStartYear = currentMonth >= fyMonth ? now.getFullYear() : now.getFullYear() - 1
  const fyEndMonth = fyMonth === 1 ? 12 : fyMonth - 1
  const fyEndYear = fyMonth === 1 ? fyStartYear : fyStartYear + 1
  const lastDay = new Date(fyEndYear, fyEndMonth, 0).getDate()

  return {
    start: `${fyStartYear}-${String(fyMonth).padStart(2, '0')}-01`,
    end: `${fyEndYear}-${String(fyEndMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    label: `${MONTH_NAMES[fyMonth - 1]} ${fyStartYear} - ${MONTH_NAMES[fyEndMonth - 1]} ${fyEndYear}`,
    fyStartMonth: fyMonth,
  }
}

const DATE_TABLES: Record<string, string> = {
  employees: 'created_at',
  expense_claims: 'date',
  leave_requests: 'start_date',
  payslips: 'pay_date',
  kudos: 'created_at',
  announcements: 'created_at',
  onboarding: 'created_at',
  hr_tickets: 'created_at',
  timesheets: 'date',
  benefit_enrollments: 'enrolled_at',
  shift_assignments: 'date',
  legal_timesheet_entries: 'date',
  performance_reviews: 'created_at',
  space_bookings: 'date',
  one_to_one_meetings: 'meeting_date',
  workflow_tracker: 'created_at',
}

const NON_DATE_TABLES = [
  'leave_types',
  'benefit_types',
  'benefit_options',
  'shift_templates',
  'rotas',
  'customer_projects',
  'legal_clients',
  'legal_matters',
  'company_features',
  'company_elearning_courses',
  'company_users',
]

export const ALL_EXPORT_TABLES = [
  ...Object.keys(DATE_TABLES),
  ...NON_DATE_TABLES,
]

function toCsvRow(values: string[]): string {
  return values.map(v => {
    const s = String(v ?? '')
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }).join(',')
}

function tableToCsv(_tableName: string, rows: Record<string, any>[]): string {
  if (rows.length === 0) return ''
  const cols = Object.keys(rows[0])
  const lines = [toCsvRow(cols)]
  for (const row of rows) {
    lines.push(toCsvRow(cols.map(c => row[c])))
  }
  return lines.join('\n')
}

export async function exportCompanyData(
  companyId: string,
  companyName: string,
  fy: FYRange,
): Promise<string> {
  const sections: string[] = []

  sections.push('--- SUMMARY ---')
  sections.push(`Company,${companyName}`)
  sections.push(`Company ID,${companyId}`)
  sections.push(`Financial Year,${fy.label}`)
  sections.push(`FY Start Month,${fy.fyStartMonth}`)
  sections.push(`Export Date,${new Date().toLocaleDateString('en-GB')}`)
  sections.push(`Export Format,InflowHR Import v1`)
  sections.push('')

  for (const table of Object.keys(DATE_TABLES)) {
    const dateCol = DATE_TABLES[table]
    const { data } = await supabase
      .from(table)
      .select('*')
      .eq('company_id', companyId)
      .gte(dateCol, fy.start)
      .lte(dateCol, fy.end + 'T23:59:59')
      .order(dateCol, { ascending: true })
    const rows = (data || []) as Record<string, any>[]
    sections.push(`--- TABLE: ${table} ---`)
    sections.push(`Rows: ${rows.length}`)
    if (rows.length > 0) {
      sections.push(tableToCsv(table, rows))
    }
    sections.push('')
  }

  for (const table of NON_DATE_TABLES) {
    const { data } = await supabase
      .from(table)
      .select('*')
      .eq('company_id', companyId)
    const rows = (data || []) as Record<string, any>[]
    sections.push(`--- TABLE: ${table} ---`)
    sections.push(`Rows: ${rows.length}`)
    if (rows.length > 0) {
      sections.push(tableToCsv(table, rows))
    }
    sections.push('')
  }

  return sections.join('\n')
}

export function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface ImportValidation {
  valid: boolean
  errors: string[]
  tables: { name: string; rowCount: number }[]
  companyName: string
  fyLabel: string
}

export function validateImportCsv(content: string): ImportValidation {
  const lines = content.split('\n')
  const errors: string[] = []
  const tables: { name: string; rowCount: number }[] = []
  let companyName = ''
  let fyLabel = ''

  const summaryIdx = lines.findIndex(l => l.trim() === '--- SUMMARY ---')
  if (summaryIdx === -1) {
    errors.push('Missing SUMMARY section — not a valid InflowHR export file')
    return { valid: false, errors, tables, companyName, fyLabel }
  }

  for (let i = summaryIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('--- TABLE:')) break
    if (line.startsWith('Company,')) companyName = line.split(',').slice(1).join(',')
    if (line.startsWith('Financial Year,')) fyLabel = line.split(',').slice(1).join(',')
    if (line.startsWith('Export Format,') && !line.includes('InflowHR Import v1')) {
      errors.push('Unrecognised export format — expected "InflowHR Import v1"')
    }
  }

  if (!companyName) errors.push('Missing Company name in SUMMARY')
  if (!fyLabel) errors.push('Missing Financial Year in SUMMARY')

  const requiredTables = ['employees', 'company_users', 'company_features']
  const tableRegex = /^--- TABLE: (.+) ---$/

  let currentTable = ''
  let headerLine = ''
  let rowCount = 0

  for (const line of lines) {
    const match = line.trim().match(tableRegex)
    if (match) {
      if (currentTable) {
        tables.push({ name: currentTable, rowCount })
      }
      currentTable = match[1]
      headerLine = ''
      rowCount = 0
      continue
    }
    if (currentTable) {
      if (line.trim().startsWith('Rows:')) continue
      if (line.trim() === '') continue
      if (!headerLine) {
        headerLine = line
      } else {
        rowCount++
      }
    }
  }
  if (currentTable) tables.push({ name: currentTable, rowCount })

  for (const req of requiredTables) {
    if (!tables.find(t => t.name === req)) {
      errors.push(`Required table "${req}" not found in import file`)
    }
  }

  return { valid: errors.length === 0, errors, tables, companyName, fyLabel }
}

function parseCsvSection(lines: string[], tableStart: number): { headers: string[]; rows: Record<string, string>[] } {
  const headers: string[] = []
  const rows: Record<string, string>[] = []
  let headerParsed = false

  for (let i = tableStart; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('--- TABLE:') || line === '') {
      if (headerParsed) break
      continue
    }
    if (line.startsWith('Rows:')) continue

    const values = parseCsvLine(line)
    if (!headerParsed) {
      headers.push(...values)
      headerParsed = true
    } else {
      const row: Record<string, string> = {}
      headers.forEach((h, idx) => { row[h] = values[idx] ?? '' })
      rows.push(row)
    }
  }
  return { headers, rows }
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        values.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  values.push(current)
  return values
}

export async function importCompanyData(
  content: string,
  targetCompanyId: string,
): Promise<{ success: boolean; imported: number; errors: string[] }> {
  const lines = content.split('\n')
  const errors: string[] = []
  let imported = 0

  const tableRegex = /^--- TABLE: (.+) ---$/
  const tableStarts: { name: string; lineIdx: number }[] = []

  lines.forEach((line, idx) => {
    const match = line.trim().match(tableRegex)
    if (match) tableStarts.push({ name: match[1], lineIdx: idx + 1 })
  })

  const idColumns = ['id']
  const skipColumns = ['created_at', 'updated_at']

  for (const { name, lineIdx } of tableStarts) {
    const { headers, rows } = parseCsvSection(lines, lineIdx)
    if (rows.length === 0) continue

    const insertRows = rows.map(row => {
      const cleaned: Record<string, any> = {}
      for (const h of headers) {
        if (idColumns.includes(h) || skipColumns.includes(h)) continue
        if (h === 'company_id') {
          cleaned[h] = targetCompanyId
          continue
        }
        const val = row[h]
        if (val === '' || val === 'null' || val === 'undefined') {
          cleaned[h] = null
        } else if (val === 'true') {
          cleaned[h] = true
        } else if (val === 'false') {
          cleaned[h] = false
        } else {
          cleaned[h] = val
        }
      }
      return cleaned
    })

    const { error } = await supabase.from(name).insert(insertRows)
    if (error) {
      errors.push(`${name}: ${error.message}`)
    } else {
      imported += insertRows.length
    }
  }

  return { success: errors.length === 0, imported, errors }
}

export async function archiveCompanyData(
  companyId: string,
  companyName: string,
  fy: FYRange,
): Promise<{ success: boolean; path: string; error?: string }> {
  const csv = await exportCompanyData(companyId, companyName, fy)
  const startLabel = fy.start.split('-').reverse().join('/')
  const endLabel = fy.end.split('-').reverse().join('/')
  const fileName = `Archive-${startLabel}-to-${endLabel}.csv`
  const storagePath = `${companyId}/${fileName}`

  const blob = new Blob([csv], { type: 'text/csv' })
  const { error } = await supabase.storage
    .from('company-archives')
    .upload(storagePath, blob, { upsert: true })

  if (error) {
    return { success: false, path: '', error: error.message }
  }

  return { success: true, path: storagePath }
}

export async function deleteCompanyFYData(
  companyId: string,
  fy: FYRange,
): Promise<{ deleted: number; errors: string[] }> {
  const errors: string[] = []
  let deleted = 0

  for (const table of Object.keys(DATE_TABLES)) {
    const dateCol = DATE_TABLES[table]
    if (table === 'employees' || table === 'company_users') continue

    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .eq('company_id', companyId)
      .gte(dateCol, fy.start)
      .lte(dateCol, fy.end + 'T23:59:59')

    if (error) {
      errors.push(`${table}: ${error.message}`)
    } else {
      deleted += count ?? 0
    }
  }

  return { deleted, errors }
}

export async function listCompanyArchives(companyId: string): Promise<{ name: string; url: string; created_at: string }[]> {
  const { data, error } = await supabase.storage
    .from('company-archives')
    .list(companyId, { sortBy: { column: 'created_at', order: 'desc' } })

  if (error || !data) return []

  return data.map(f => {
    const { data: urlData } = supabase.storage.from('company-archives').getPublicUrl(`${companyId}/${f.name}`)
    return {
      name: f.name.replace('.csv', ''),
      url: urlData.publicUrl,
      created_at: f.created_at || '',
    }
  })
}
