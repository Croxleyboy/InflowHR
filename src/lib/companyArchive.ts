import { supabase } from './supabase'
import JSZip from 'jszip'

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

export interface ArchiveFile {
  name: string
  url: string
  created_at: string
  companyName?: string
}

export async function listCompanyArchives(companyId: string): Promise<ArchiveFile[]> {
  const { data, error } = await supabase.storage
    .from('company-archives')
    .list(companyId, { sortBy: { column: 'created_at', order: 'desc' } })

  if (error || !data) return []

  const files: ArchiveFile[] = []
  for (const f of data) {
    if (!f.name || f.name.startsWith('.')) continue
    const { data: signedData } = await supabase.storage
      .from('company-archives')
      .createSignedUrl(`${companyId}/${f.name}`, 3600)
    files.push({
      name: f.name.replace('.csv', ''),
      url: signedData?.signedUrl || '',
      created_at: f.created_at || f.updated_at || '',
    })
  }
  return files
}

export async function listAllCompanyArchives(): Promise<ArchiveFile[]> {
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')
    .order('name')
  if (!companies) return []

  const all: ArchiveFile[] = []
  for (const co of companies) {
    const archives = await listCompanyArchives(co.id)
    for (const a of archives) {
      all.push({ ...a, companyName: co.name })
    }
  }
  return all
}

const STORAGE_BUCKETS = ['receipts', 'profile-photos'] as const

const TABLE_INSERT_ORDER = [
  'company', 'app_settings', 'company_features',
  'employees', 'company_users',
  'leave_types', 'leave_requests', 'leave_balances',
  'payslips',
  'expense_claims', 'expense_line_items',
  'timesheets',
  'benefits', 'benefit_types', 'benefit_options', 'benefit_enrollments', 'employee_benefits',
  'rotas', 'shift_templates', 'shift_assignments', 'shift_swap_requests', 'employee_availability',
  'performance_reviews', 'kudos',
  'legal_clients', 'legal_matters', 'legal_timesheet_entries',
  'hr_tickets',
  'one_to_one_meetings', 'one_to_one_comments',
  'onboarding',
  'announcements', 'notifications',
  'workflow_tracker',
  'company_elearning_courses', 'courses', 'course_enrolments',
  'checkin_records', 'break_records',
  'space_bookings',
  'employee_skills', 'employee_certifications', 'skill_evidence', 'skill_validations',
  'company_assets', 'asset_updates',
  'employee_consents',
  'billing_snapshots',
  'user_settings',
  'gdpr_audit_logs',
  'tenant_support_access',
]

const NON_RECOVERABLE_ITEMS = [
  'Auth accounts — users must re-register or be re-invited via SSO/email',
  'Active sessions and JWT tokens',
  'SSO/SAML configuration — must be reconfigured with identity provider',
  'Edge Function secrets and environment variables',
  'External integration tokens (Xero, Slack webhooks)',
  'Storage bucket files are included but must be re-uploaded via the restore script',
  'pg_cron scheduled jobs must be recreated',
  'RLS policies are part of the schema, not the data archive',
]

async function fetchStorageFiles(companyId: string): Promise<{ path: string; data: Blob }[]> {
  const files: { path: string; data: Blob }[] = []

  for (const bucket of STORAGE_BUCKETS) {
    const { data: listing } = await supabase.storage
      .from(bucket)
      .list(companyId, { limit: 500 })

    if (!listing || listing.length === 0) continue

    for (const file of listing) {
      if (!file.name || file.name.startsWith('.')) continue
      const filePath = `${companyId}/${file.name}`
      const { data: blob } = await supabase.storage
        .from(bucket)
        .download(filePath)

      if (blob) {
        files.push({ path: `storage/${bucket}/${file.name}`, data: blob })
      }
    }
  }

  return files
}

function buildRestoreSql(data: Record<string, unknown>, companyId: string): string {
  const lines: string[] = [
    '-- InflowHR Company Restore Script',
    '-- Generated: ' + new Date().toISOString(),
    `-- Company ID: ${companyId}`,
    '-- WARNING: Run this in a transaction. UUIDs are preserved from the original.',
    '-- Auth accounts must be recreated separately — see auth-mapping.json',
    '',
    'BEGIN;',
    '',
  ]

  for (const table of TABLE_INSERT_ORDER) {
    const rows = data[table]
    if (!rows) continue

    const rowArray = Array.isArray(rows) ? rows : [rows]
    if (rowArray.length === 0) continue

    lines.push(`-- ${table}: ${rowArray.length} row(s)`)

    for (const row of rowArray) {
      if (!row || typeof row !== 'object') continue
      const record = row as Record<string, unknown>
      const cols = Object.keys(record)
      const vals = cols.map(c => {
        const v = record[c]
        if (v === null || v === undefined) return 'NULL'
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
        if (typeof v === 'number') return String(v)
        if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb"
        return "'" + String(v).replace(/'/g, "''") + "'"
      })
      lines.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING;`)
    }
    lines.push('')
  }

  lines.push('COMMIT;')
  return lines.join('\n')
}

function buildAuthMapping(data: Record<string, unknown>): Record<string, unknown>[] {
  const companyUsers = (data.company_users || []) as Record<string, unknown>[]
  const employees = (data.employees || []) as Record<string, unknown>[]

  return companyUsers.map(cu => {
    const emp = employees.find(e => (e as Record<string, unknown>).id === cu.employee_id)
    return {
      original_auth_uid: cu.user_id,
      employee_id: cu.employee_id,
      employee_name: emp ? `${(emp as Record<string, unknown>).first_name} ${(emp as Record<string, unknown>).last_name}` : 'Unknown',
      email: cu.email || (emp as Record<string, unknown>)?.email || null,
      role: cu.role,
      note: 'User must re-register. Map their new auth.uid to this employee_id in company_users.',
    }
  })
}

export interface RestorableArchiveResult {
  success: boolean
  blob?: Blob
  filename?: string
  tableCount: number
  totalRows: number
  storageFiles: number
  error?: string
}

export async function buildRestorableArchive(
  companyId: string,
  companyName: string,
  onProgress?: (msg: string) => void,
): Promise<RestorableArchiveResult> {
  const zip = new JSZip()
  const tablesFolder = zip.folder('tables')!
  let totalRows = 0
  let tableCount = 0

  onProgress?.('Exporting company data…')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc('export_company_data' as any, { p_company_id: companyId })
  if (error) {
    return { success: false, tableCount: 0, totalRows: 0, storageFiles: 0, error: error.message }
  }

  const exportData = data as Record<string, unknown>

  onProgress?.('Packaging tables…')

  for (const [key, val] of Object.entries(exportData)) {
    if (key === 'export_metadata') continue
    const rows = Array.isArray(val) ? val : (val && typeof val === 'object' ? [val] : [])
    if (rows.length === 0) continue
    tablesFolder.file(`${key}.json`, JSON.stringify(rows, null, 2))
    totalRows += rows.length
    tableCount++
  }

  onProgress?.('Downloading storage files…')

  const storageFiles = await fetchStorageFiles(companyId)
  for (const sf of storageFiles) {
    zip.file(sf.path, sf.data)
  }

  onProgress?.('Generating restore script…')

  zip.file('restore.sql', buildRestoreSql(exportData, companyId))
  zip.file('auth-mapping.json', JSON.stringify(buildAuthMapping(exportData), null, 2))

  const manifest = {
    format: 'InflowHR Restorable Archive v1',
    created_at: new Date().toISOString(),
    company_id: companyId,
    company_name: companyName,
    tables: tableCount,
    total_rows: totalRows,
    storage_files: storageFiles.length,
    storage_buckets: STORAGE_BUCKETS.filter(b =>
      storageFiles.some(sf => sf.path.startsWith(`storage/${b}/`))
    ),
    non_recoverable: NON_RECOVERABLE_ITEMS,
    restore_instructions: 'See RESTORE_GUIDE.md for step-by-step instructions.',
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  zip.file('RESTORE_GUIDE.md', `# InflowHR Company Restore Guide

## Archive Contents
- \`tables/\` — JSON files for each database table (UUIDs preserved)
- \`storage/\` — Bucket files (receipts, profile photos)
- \`restore.sql\` — SQL script to re-insert all table data
- \`auth-mapping.json\` — Maps original auth UIDs to employee records
- \`manifest.json\` — Archive metadata and contents summary

## Restore Steps

### 1. Create a new company
Register a new company on InflowHR or use an existing empty company.
Note the new \`company_id\`.

### 2. Update restore.sql
If restoring to a DIFFERENT company_id:
- Find and replace the original company_id with the new one in \`restore.sql\`
- The original company_id is: \`${companyId}\`

### 3. Run restore.sql
Execute the SQL script against your Supabase database:
\`\`\`
psql -h <db-host> -U postgres -d postgres -f restore.sql
\`\`\`
The script uses \`ON CONFLICT DO NOTHING\` so it is safe to re-run.

### 4. Re-upload storage files
Upload files from the \`storage/\` folder back to their respective buckets:
- \`storage/receipts/*\` → \`receipts/{company_id}/\`
- \`storage/profile-photos/*\` → \`profile-photos/{company_id}/\`

### 5. Re-create auth accounts
Users must re-register or be re-invited. Use \`auth-mapping.json\` to:
1. Invite each user by email
2. Once they have a new auth UID, update \`company_users.user_id\` to the new UID

### 6. Reconfigure integrations
The following must be manually reconfigured:
${NON_RECOVERABLE_ITEMS.map(item => `- ${item}`).join('\n')}

## Data Integrity
All UUIDs and foreign keys are preserved from the original database.
If restoring to the same company_id, data will be re-inserted with matching references.

## Company: ${companyName}
## Archived: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
`)

  onProgress?.('Creating ZIP archive…')

  const blob = await zip.generateAsync({ type: 'blob' })
  const dateStr = new Date().toLocaleDateString('en-GB').replace(/\//g, '-')
  const filename = `${companyName.replace(/\s+/g, '-').toLowerCase()}-restorable-archive-${dateStr}.zip`

  return {
    success: true,
    blob,
    filename,
    tableCount,
    totalRows,
    storageFiles: storageFiles.length,
  }
}
