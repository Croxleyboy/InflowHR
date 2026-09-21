import { useState, useEffect, useMemo, useCallback } from 'react'
import JSZip from 'jszip'
import { supabase } from '../../lib/supabase'
import { sendFeatureEmail } from '../../lib/emailNotifications'
import { getCompanyFY } from '../../lib/companyArchive'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'

interface Claim {
  id: number
  employee_id: string
  reference_number: string
  title: string
  amount: number
  status: string
  cost_center: string
  created_at: string
  submitted_at: string | null
  employee: { first_name: string; last_name: string; email: string; avatar_url: string | null } | null
  line_items?: LineItem[]
}
interface LineItem {
  id: number
  title: string
  expense_type: string
  amount: number
  date_of_purchase: string
  receipt_url: string | null
}
interface ExportLog {
  id: number
  exported_by: string
  file_name: string
  exported_at: string
}

const STATUS_OPTIONS = ['draft', 'pending', 'approved', 'rejected']
const DEFAULT_COST_CENTERS = ['External expenses', 'Internal costs', 'Travel & Transport', 'Client entertainment', 'Office supplies', 'IT & Software', 'Training & Development']
const DEFAULT_EXPENSE_TYPES = [
  'Flights', 'Trains', 'Taxis', 'Car rental', 'Mileage', 'Parking and tolls',
  'Hotel stays for business', 'Meals while travelling', 'Client entertainment',
  'Stationery', 'Equipment or tools', 'Software or subscriptions',
  'Mobile phone usage', 'Internet/data charges', 'Course fees/certifications or conferences',
]

const CAL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const PAGE_SIZE = 30

export default function AdminExpenses() {
  const { selectedCompanyId } = useAdminCompany()
  const { employeeEmail, employeeName } = useAuth()
  const { t } = useLanguage()
  const { showError, showSuccess } = useToast()
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Claim>>({})
  const [editingLineId, setEditingLineId] = useState<number | null>(null)
  const [lineForm, setLineForm] = useState<Partial<LineItem>>({})
  const [tab, setTab] = useState<'claims' | 'settings' | 'chart' | 'exports'>('claims')
  const [costCenters, setCostCenters] = useState<string[]>([])
  const [expenseTypes, setExpenseTypes] = useState<string[]>([])
  const [newCostCenter, setNewCostCenter] = useState('')
  const [newExpenseType, setNewExpenseType] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportingXero, setExportingXero] = useState(false)
  const [exportLogs, setExportLogs] = useState<ExportLog[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [fyStartMonth, setFyStartMonth] = useState(4)
  const [fyLabel, setFyLabel] = useState('')
  const [exportMonth, setExportMonth] = useState('all')

  const fyMonthOptions = useMemo(() => {
    const opts: { value: string; label: string; start: Date; end: Date }[] = []
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const fyStartYear = currentMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
    for (let i = 0; i < 12; i++) {
      const d = new Date(fyStartYear, fyStartMonth - 1 + i, 1)
      const m = d.getMonth()
      const y = d.getFullYear()
      const end = new Date(y, m + 1, 1)
      opts.push({ value: `${y}-${m}`, label: `${CAL_MONTHS[m]} ${y}`, start: d, end })
    }
    return opts
  }, [fyStartMonth])

  const loadExportLogs = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('expense_export_log')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('exported_at', { ascending: false })
      .limit(50)
    if (data) setExportLogs(data)
  }, [selectedCompanyId])

  const loadExpenseSettings = useCallback(async () => {
    if (!selectedCompanyId) return
    setSettingsLoading(true)
    const [ccResult, etResult] = await Promise.all([
      supabase.from('expense_cost_centers').select('name').eq('company_id', selectedCompanyId).order('sort_order'),
      supabase.from('expense_expense_types').select('name').eq('company_id', selectedCompanyId).order('sort_order'),
    ])
    if (ccResult.data && ccResult.data.length > 0) {
      setCostCenters(ccResult.data.map((r: any) => r.name))
    } else {
      setCostCenters([...DEFAULT_COST_CENTERS])
      const rows = DEFAULT_COST_CENTERS.map((name, i) => ({ company_id: selectedCompanyId, name, sort_order: i }))
      await supabase.from('expense_cost_centers').insert(rows)
    }
    if (etResult.data && etResult.data.length > 0) {
      setExpenseTypes(etResult.data.map((r: any) => r.name))
    } else {
      setExpenseTypes([...DEFAULT_EXPENSE_TYPES])
      const rows = DEFAULT_EXPENSE_TYPES.map((name, i) => ({ company_id: selectedCompanyId, name, sort_order: i }))
      await supabase.from('expense_expense_types').insert(rows)
    }
    setSettingsLoading(false)
  }, [selectedCompanyId])

  useEffect(() => {
    if (!selectedCompanyId) return
    loadClaims()
    loadExpenseSettings()
    getCompanyFY(selectedCompanyId).then(fy => {
      setFyStartMonth(fy.fyStartMonth)
      setFyLabel(fy.label)
    })
  }, [selectedCompanyId, loadExpenseSettings])
  useEffect(() => { if (selectedCompanyId) loadExportLogs() }, [selectedCompanyId, loadExportLogs])

  async function exportExpenses() {
    if (!selectedCompanyId) return
    setExporting(true)
    try {
      let rangeStart: Date
      let rangeEnd: Date
      let rangeLabel: string

      if (exportMonth === 'all') {
        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const fyStartYear = currentMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
        rangeStart = new Date(fyStartYear, fyStartMonth - 1, 1)
        rangeEnd = new Date(fyStartYear + 1, fyStartMonth - 1, 1)
        rangeLabel = `FY ${fyStartYear}-${fyStartYear + 1}`
      } else {
        const selected = fyMonthOptions.find(o => o.value === exportMonth)
        if (!selected) { setExporting(false); return }
        rangeStart = selected.start
        rangeEnd = selected.end
        rangeLabel = selected.label
      }

      const { data: expClaims } = await supabase
        .from('expense_claims')
        .select('*, employee:employees!expense_claims_employee_id_fkey(first_name, last_name, email, avatar_url)')
        .eq('company_id', selectedCompanyId)
        .in('status', ['pending', 'approved'])
        .gte('submitted_at', rangeStart.toISOString())
        .lt('submitted_at', rangeEnd.toISOString())
        .order('submitted_at', { ascending: false })

      if (!expClaims || expClaims.length === 0) {
        showError(`No submitted or approved expenses for ${rangeLabel}`)
        setExporting(false)
        return
      }

      const claimIds = expClaims.map(c => c.id)
      const { data: lineItems } = await supabase
        .from('expense_line_items')
        .select('*')
        .in('expense_claim_id', claimIds)
        .order('date_of_purchase')

      const linesByClaimId: Record<number, LineItem[]> = {}
      lineItems?.forEach((li: any) => {
        if (!linesByClaimId[li.expense_claim_id]) linesByClaimId[li.expense_claim_id] = []
        linesByClaimId[li.expense_claim_id].push(li)
      })

      const zip = new JSZip()
      const now = new Date()
      const folderName = `Expenses_${rangeLabel.replace(/\s+/g, '_')}_${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`
      const folder = zip.folder(folderName)!
      const receiptsFolder = folder.folder('receipts')!

      const csvHeader = 'Ref,Employee,Email,Title,Cost Center,Status,Submitted,Amount,Line Item,Expense Type,Purchase Date,Line Amount,Receipt File\n'
      let csvRows = ''
      let receiptIndex = 0

      for (const claim of expClaims) {
        const empName = claim.employee ? `${claim.employee.first_name} ${claim.employee.last_name}` : ''
        const empEmail = claim.employee?.email || ''
        const submitted = claim.submitted_at ? new Date(claim.submitted_at).toLocaleDateString('en-GB') : ''
        const lines = linesByClaimId[claim.id] || []

        if (lines.length === 0) {
          csvRows += `"${claim.reference_number}","${empName}","${empEmail}","${claim.title}","${claim.cost_center || ''}","${claim.status}","${submitted}","${Number(claim.amount).toFixed(2)}","","","","",""\n`
          continue
        }

        for (const li of lines) {
          let receiptFilename = ''
          if (li.receipt_url) {
            receiptIndex++
            const ext = li.receipt_url.split('.').pop()?.split('?')[0] || 'jpg'
            receiptFilename = `${claim.reference_number}_${receiptIndex}.${ext}`
            try {
              const response = await fetch(li.receipt_url)
              if (response.ok) {
                const blob = await response.blob()
                receiptsFolder.file(receiptFilename, blob)
              }
            } catch {}
          }
          const purchaseDate = li.date_of_purchase ? new Date(li.date_of_purchase).toLocaleDateString('en-GB') : ''
          csvRows += `"${claim.reference_number}","${empName}","${empEmail}","${claim.title}","${claim.cost_center || ''}","${claim.status}","${submitted}","${Number(claim.amount).toFixed(2)}","${li.title}","${li.expense_type}","${purchaseDate}","${Number(li.amount).toFixed(2)}","${receiptFilename}"\n`
        }
      }

      folder.file('expenses.csv', csvHeader + csvRows)

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
      const zipFileName = `${folderName}.zip`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = zipFileName
      a.click()
      URL.revokeObjectURL(url)

      const now2 = new Date()
      const exportDate = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}-${String(now2.getDate()).padStart(2, '0')}`
      const exportedBy = employeeName || employeeEmail
      await supabase.from('expense_export_log').upsert({
        company_id: selectedCompanyId,
        exported_by: exportedBy,
        file_name: zipFileName,
        export_date: exportDate,
        exported_at: now2.toISOString(),
      }, { onConflict: 'company_id,exported_by,export_date' })
      loadExportLogs()

      showSuccess(`Exported ${expClaims.length} claims with ${receiptIndex} receipts`)
    } catch (err: any) {
      showError('Export failed: ' + (err.message || 'Unknown error'))
    }
    setExporting(false)
  }

  const XERO_ACCOUNT_MAP: Record<string, string> = {
    'Flights': '493', 'Trains': '493', 'Taxis': '493', 'Car rental': '493',
    'Mileage': '494', 'Parking and tolls': '493', 'Hotel stays for business': '489',
    'Meals while travelling': '424', 'Client entertainment': '420',
    'Stationery': '461', 'Equipment or tools': '461', 'Software or subscriptions': '463',
    'Mobile phone usage': '449', 'Internet/data charges': '449',
    'Course fees/certifications or conferences': '404',
  }

  async function exportXero() {
    if (!selectedCompanyId) return
    setExportingXero(true)
    try {
      let rangeStart: Date
      let rangeEnd: Date
      let rangeLabel: string

      if (exportMonth === 'all') {
        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const fyStartYear = currentMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
        rangeStart = new Date(fyStartYear, fyStartMonth - 1, 1)
        rangeEnd = new Date(fyStartYear + 1, fyStartMonth - 1, 1)
        rangeLabel = `FY ${fyStartYear}-${fyStartYear + 1}`
      } else {
        const selected = fyMonthOptions.find(o => o.value === exportMonth)
        if (!selected) { setExportingXero(false); return }
        rangeStart = selected.start
        rangeEnd = selected.end
        rangeLabel = selected.label
      }

      const { data: expClaims } = await supabase
        .from('expense_claims')
        .select('*, employee:employees!expense_claims_employee_id_fkey(first_name, last_name, email)')
        .eq('company_id', selectedCompanyId)
        .in('status', ['pending', 'approved'])
        .gte('submitted_at', rangeStart.toISOString())
        .lt('submitted_at', rangeEnd.toISOString())
        .order('submitted_at', { ascending: false })

      if (!expClaims || expClaims.length === 0) {
        showError(`No submitted or approved expenses for ${rangeLabel}`)
        setExportingXero(false)
        return
      }

      const claimIds = expClaims.map(c => c.id)
      const { data: lineItems } = await supabase
        .from('expense_line_items')
        .select('*')
        .in('expense_claim_id', claimIds)
        .order('date_of_purchase')

      const linesByClaimId: Record<number, LineItem[]> = {}
      lineItems?.forEach((li: any) => {
        if (!linesByClaimId[li.expense_claim_id]) linesByClaimId[li.expense_claim_id] = []
        linesByClaimId[li.expense_claim_id].push(li)
      })

      const xeroHeader = 'ContactName,InvoiceNumber,Reference,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType,TrackingName1,TrackingOption1\n'
      let xeroRows = ''

      for (const claim of expClaims) {
        const contactName = claim.employee ? `${claim.employee.first_name} ${claim.employee.last_name}` : ''
        const invoiceDate = claim.submitted_at ? new Date(claim.submitted_at).toLocaleDateString('en-GB') : ''
        const dueDate = claim.submitted_at
          ? new Date(new Date(claim.submitted_at).getTime() + 30 * 86400000).toLocaleDateString('en-GB')
          : ''
        const lines = linesByClaimId[claim.id] || []

        if (lines.length === 0) {
          xeroRows += `"${contactName}","${claim.reference_number}","${claim.title}","${invoiceDate}","${dueDate}","${claim.title}","1","${Number(claim.amount).toFixed(2)}","429","20% (VAT on Expenses)","",""\n`
          continue
        }

        for (const li of lines) {
          const desc = `${li.title} (${li.expense_type})`
          const accountCode = XERO_ACCOUNT_MAP[li.expense_type] || '429'
          xeroRows += `"${contactName}","${claim.reference_number}","${claim.title}","${invoiceDate}","${dueDate}","${desc}","1","${Number(li.amount).toFixed(2)}","${accountCode}","20% (VAT on Expenses)","${claim.cost_center ? 'Cost Centre' : ''}","${claim.cost_center || ''}"\n`
        }
      }

      const csvContent = xeroHeader + xeroRows
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const now = new Date()
      const fileName = `Xero_Bills_${rangeLabel.replace(/\s+/g, '_')}_${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}.csv`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)

      showSuccess(`Xero export: ${expClaims.length} claims ready for import`)
    } catch (err: any) {
      showError('Xero export failed: ' + (err.message || 'Unknown error'))
    }
    setExportingXero(false)
  }

  async function loadClaims() {
    setLoading(true)
    const { data } = await supabase
      .from('expense_claims')
      .select('*, employee:employees!expense_claims_employee_id_fkey(first_name, last_name, email, avatar_url)')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    setClaims((data as Claim[]) || [])
    setLoading(false)
  }

  async function loadLineItems(claimId: number) {
    const { data } = await supabase.from('expense_line_items').select('*').eq('expense_claim_id', claimId).order('date_of_purchase')
    if (data) {
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, line_items: data } : c))
    }
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    setEditingId(null)
    const claim = claims.find(c => c.id === id)
    if (!claim?.line_items) await loadLineItems(id)
  }

  function startEdit(claim: Claim) {
    setEditingId(claim.id)
    setEditForm({ title: claim.title, amount: claim.amount, status: claim.status, cost_center: claim.cost_center })
  }

  async function saveEdit(id: number) {
    const claim = claims.find(c => c.id === id)
    const oldStatus = claim?.status
    const newStatus = editForm.status

    const { error } = await supabase.from('expense_claims').update({
      title: editForm.title, amount: editForm.amount, status: newStatus, cost_center: editForm.cost_center,
      approved_at: newStatus === 'approved' ? new Date().toISOString() : null,
    }).eq('id', id)
    if (error) { showError('Failed to save expense claim: ' + error.message); return }

    if (claim && oldStatus === 'pending' && (newStatus === 'approved' || newStatus === 'rejected')) {
      const empName = claim.employee ? `${claim.employee.first_name} ${claim.employee.last_name}` : ''
      const empEmail = claim.employee?.email || ''
      const approved = newStatus === 'approved'
      const now = new Date().toISOString()
      const amountStr = `£${Number(claim.amount).toFixed(2)}`

      const { data: pendingWf } = await supabase.from('workflow_tracker')
        .select('assigned_to')
        .eq('record_type', 'Expense').eq('approval_id', id).eq('status', 'Pending')
        .eq('company_id', selectedCompanyId).limit(1).maybeSingle()
      const approverEmail = pendingWf?.assigned_to || ''

      await supabase.from('workflow_tracker').update({
        status: 'Complete',
        approval_status: approved ? 'Approved' : 'Declined',
        updated_at: now,
        task_description: approved
          ? `Expense claim ${claim.reference_number} approved - ${amountStr}`
          : `Expense claim ${claim.reference_number} declined`,
      }).eq('record_type', 'Expense').eq('approval_id', id).eq('status', 'Pending').eq('company_id', selectedCompanyId)

      await supabase.from('workflow_tracker').insert({
        emp_display_name: empName,
        step: 2, status: 'Complete', record_type: 'Expense',
        action: approved ? 'Expense approved' : 'Expense declined',
        employee_email: empEmail, assigned_to: empEmail,
        approval_id: id, reminder_count: 1,
        task_description: approved
          ? `Your expense claim ${claim.reference_number} (${amountStr}) has been approved by admin.`
          : `Your expense claim ${claim.reference_number} (${amountStr}) has been declined by admin. Please contact your manager.`,
        approval_status: approved ? 'Approved' : 'Declined',
        company_id: selectedCompanyId,
      })

      if (approverEmail) {
        await supabase.from('workflow_tracker').insert({
          emp_display_name: 'Admin',
          step: 2, status: 'Complete', record_type: 'Expense',
          action: approved ? 'Expense approved by admin' : 'Expense declined by admin',
          employee_email: approverEmail, assigned_to: approverEmail,
          approval_id: id, reminder_count: 1,
          task_description: `Admin ${approved ? 'approved' : 'declined'} expense claim ${claim.reference_number} (${amountStr}) for ${empName}`,
          approval_status: approved ? 'Approved' : 'Declined',
          company_id: selectedCompanyId,
        })
      }

      if (selectedCompanyId && claim.employee_id) {
        sendFeatureEmail({
          companyId: selectedCompanyId,
          employeeId: claim.employee_id,
          featureKey: 'expenses_enabled',
          title: approved ? 'Expense Claim Approved' : 'Expense Claim Declined',
          message: approved
            ? `Your expense claim ${claim.reference_number} (${amountStr}) has been approved by admin.`
            : `Your expense claim ${claim.reference_number} (${amountStr}) has been declined by admin. Please contact your manager for details.`,
          type: approved ? 'info' : 'alert',
          link: '/expenses',
        })
      }

      window.dispatchEvent(new Event('notifications-updated'))
    }

    setEditingId(null)
    loadClaims()
    showSuccess('Expense claim saved')
  }

  async function deleteClaim(id: number) {
    if (!confirm('Delete this expense claim and all line items?')) return
    const { error } = await supabase.from('expense_claims').delete().eq('id', id)
    if (error) { showError('Failed to delete expense claim: ' + error.message); return }
    setClaims(prev => prev.filter(c => c.id !== id))
    setExpandedId(null)
    showSuccess('Expense claim deleted')
  }

  function startLineEdit(item: LineItem) {
    setEditingLineId(item.id)
    setLineForm({ title: item.title, expense_type: item.expense_type, amount: item.amount, date_of_purchase: item.date_of_purchase })
  }

  async function saveLineEdit(lineId: number, claimId: number) {
    const { error } = await supabase.from('expense_line_items').update({
      title: lineForm.title, expense_type: lineForm.expense_type, amount: lineForm.amount, date_of_purchase: lineForm.date_of_purchase,
    }).eq('id', lineId)
    if (error) { showError('Failed to save line item: ' + error.message); return }
    setEditingLineId(null)
    await loadLineItems(claimId)
    const { data } = await supabase.from('expense_line_items').select('amount').eq('expense_claim_id', claimId)
    if (data) {
      const total = data.reduce((s, r) => s + Number(r.amount), 0)
      const { error: totalError } = await supabase.from('expense_claims').update({ amount: total }).eq('id', claimId)
      if (totalError) { showError('Failed to update claim total: ' + totalError.message); return }
      loadClaims()
    }
  }

  async function deleteLineItem(lineId: number, claimId: number) {
    if (!confirm('Delete this line item?')) return
    const { error } = await supabase.from('expense_line_items').delete().eq('id', lineId)
    if (error) { showError('Failed to delete line item: ' + error.message); return }
    await loadLineItems(claimId)
    const { data } = await supabase.from('expense_line_items').select('amount').eq('expense_claim_id', claimId)
    if (data) {
      const total = data.reduce((s, r) => s + Number(r.amount), 0)
      const { error: totalError } = await supabase.from('expense_claims').update({ amount: total }).eq('id', claimId)
      if (totalError) { showError('Failed to update claim total: ' + totalError.message); return }
      loadClaims()
    }
  }

  const employees = useMemo(() => {
    const names = new Set<string>()
    claims.forEach(c => { if (c.employee) names.add(`${c.employee.first_name} ${c.employee.last_name}`) })
    return Array.from(names).sort()
  }, [claims])

  const filtered = useMemo(() => {
    setPage(1)
    return claims.filter(c => {
      if (filterStatus && c.status !== filterStatus) return false
      if (filterEmployee && c.employee && `${c.employee.first_name} ${c.employee.last_name}` !== filterEmployee) return false
      if (search) {
        const s = search.toLowerCase()
        const empName = c.employee ? `${c.employee.first_name} ${c.employee.last_name}`.toLowerCase() : ''
        if (
          !empName.includes(s) &&
          !c.title.toLowerCase().includes(s) &&
          !c.status.toLowerCase().includes(s) &&
          !c.reference_number.toLowerCase().includes(s) &&
          !(c.cost_center || '').toLowerCase().includes(s)
        ) return false
      }
      return true
    })
  }, [claims, filterStatus, filterEmployee, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const expenseExportDaysAgo = useMemo(() => {
    if (exportLogs.length === 0) return -1
    return Math.floor((Date.now() - new Date(exportLogs[0].exported_at).getTime()) / (1000 * 60 * 60 * 24))
  }, [exportLogs])

  const chartData = useMemo(() => {
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const fyStartYear = currentMonth >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1
    const months: { label: string; approved: number; submitted: number; declined: number }[] = []
    for (let i = 0; i < 12; i++) {
      const d = new Date(fyStartYear, fyStartMonth - 1 + i, 1)
      const m = d.getMonth()
      const y = d.getFullYear()
      const label = `${CAL_MONTHS[m]} ${y}`
      const inMonth = claims.filter(c => {
        const cd = new Date(c.created_at)
        return cd.getMonth() === m && cd.getFullYear() === y && c.status !== 'draft'
      })
      months.push({
        label,
        approved: inMonth.filter(c => c.status === 'approved').reduce((s, c) => s + Number(c.amount), 0),
        submitted: inMonth.filter(c => c.status === 'pending' || c.status === 'submitted').reduce((s, c) => s + Number(c.amount), 0),
        declined: inMonth.filter(c => c.status === 'rejected').reduce((s, c) => s + Number(c.amount), 0),
      })
    }
    const totalApproved = months.reduce((s, m) => s + m.approved, 0)
    const totalSubmitted = months.reduce((s, m) => s + m.submitted, 0)
    const totalDeclined = months.reduce((s, m) => s + m.declined, 0)
    const overallTotal = totalApproved + totalSubmitted + totalDeclined
    const max = Math.max(...months.map(m => m.approved + m.submitted + m.declined), 1)
    return { months, max, totalApproved, totalSubmitted, totalDeclined, overallTotal }
  }, [claims, fyStartMonth])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Expense Management</h2>
        <p>{claims.length} total claims</p>
      </div>

      {(expenseExportDaysAgo === -1 || expenseExportDaysAgo >= 25) && (
        <div onClick={() => setTab('exports')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff3e0', border: '1px solid #ffb74d', borderRadius: 10, marginBottom: 12, cursor: 'pointer' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div style={{ flex: 1 }}>
            <strong style={{ color: '#e65100', fontSize: 13 }}>
              {expenseExportDaysAgo === -1 ? 'Expenses have never been exported' : `Expense export is ${expenseExportDaysAgo} days old`}
            </strong>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#bf360c' }}>
              Tap here to export the latest expenses and receipts
            </p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      )}

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'claims' ? 'admin-tab-active' : ''}`} onClick={() => setTab('claims')}>Claims</button>
        <button className={`admin-tab ${tab === 'chart' ? 'admin-tab-active' : ''}`} onClick={() => setTab('chart')}>Analytics</button>
        <button className={`admin-tab ${tab === 'exports' ? 'admin-tab-active' : ''}`} onClick={() => setTab('exports')}>Exports</button>
        <button className={`admin-tab ${tab === 'settings' ? 'admin-tab-active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
      </div>

      {tab === 'claims' && (
        <>
          <div className="admin-filters">
            <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} className="admin-select">
              <option value="">All Employees</option>
              {employees.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="admin-select">
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <select value={exportMonth} onChange={e => setExportMonth(e.target.value)} className="admin-select" style={{ minWidth: 130 }}>
                <option value="all">All Months</option>
                {fyMonthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button className="admin-btn-sm admin-btn-save" onClick={exportExpenses} disabled={exporting} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {exporting ? 'Exporting...' : 'Export'}
              </button>
              <button className="admin-btn-sm" onClick={exportXero} disabled={exportingXero} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', background: '#13b5ea', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {exportingXero ? 'Exporting...' : 'Export for Xero'}
              </button>
            </div>
          </div>

          <input
            className="admin-input"
            placeholder="Search expenses..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: 12, width: '100%', maxWidth: 320 }}
          />

          {loading ? <div className="admin-loading">Loading...</div> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ref</th><th>Employee</th><th>Title</th><th>Amount</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(claim => (
                    <>
                      <tr key={claim.id} className={expandedId === claim.id ? 'admin-row-active' : ''}>
                        <td className="admin-td-mono">{claim.reference_number}</td>
                        <td>{claim.employee ? <span className="admin-inline-avatar">{claim.employee.avatar_url ? <img src={claim.employee.avatar_url} alt="" /> : <span className="admin-avatar-initials">{claim.employee.first_name[0]}{claim.employee.last_name[0]}</span>}{claim.employee.first_name} {claim.employee.last_name}</span> : '—'}</td>
                        <td>{editingId === claim.id ? <input className="admin-inline-input" value={editForm.title || ''} onChange={e => setEditForm(p => ({...p, title: e.target.value}))} /> : claim.title}</td>
                        <td>{editingId === claim.id ? <input type="number" className="admin-inline-input admin-inline-sm" value={editForm.amount ?? ''} onChange={e => setEditForm(p => ({...p, amount: +e.target.value}))} /> : `£${Number(claim.amount).toFixed(2)}`}</td>
                        <td>{editingId === claim.id ? (
                          <select className="admin-inline-select" value={editForm.status || ''} onChange={e => setEditForm(p => ({...p, status: e.target.value}))}>
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : <span className={`admin-badge admin-badge-${claim.status}`}>{claim.status}</span>}</td>
                        <td className="admin-actions">
                          {editingId === claim.id ? (
                            <>
                              <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(claim.id)}>Save</button>
                              <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="admin-btn-icon" title="Expand" onClick={() => toggleExpand(claim.id)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={expandedId === claim.id ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
                              </button>
                              <button className="admin-btn-icon" title="Edit" onClick={() => startEdit(claim)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                              <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteClaim(claim.id)}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {expandedId === claim.id && (
                        <tr key={`exp-${claim.id}`} className="admin-expanded-row">
                          <td colSpan={6}>
                            <div className="admin-expanded-content">
                              <div className="admin-detail-grid">
                                <div><strong>Cost Center:</strong> {claim.cost_center || '—'}</div>
                                <div><strong>Submitted:</strong> {claim.submitted_at ? new Date(claim.submitted_at).toLocaleDateString('en-GB') : '—'}</div>
                                <div><strong>Created:</strong> {new Date(claim.created_at).toLocaleDateString('en-GB')}</div>
                              </div>
                              <h4>Line Items</h4>
                              {(claim.line_items && claim.line_items.length > 0) ? (
                                <table className="admin-subtable">
                                  <thead><tr><th>Item</th><th>Type</th><th>Date</th><th>Amount</th><th>Receipt</th><th></th></tr></thead>
                                  <tbody>
                                    {claim.line_items.map(li => (
                                      <tr key={li.id}>
                                        <td>{editingLineId === li.id ? <input className="admin-inline-input" value={lineForm.title || ''} onChange={e => setLineForm(p => ({...p, title: e.target.value}))} /> : li.title}</td>
                                        <td>{editingLineId === li.id ? <input className="admin-inline-input" value={lineForm.expense_type || ''} onChange={e => setLineForm(p => ({...p, expense_type: e.target.value}))} /> : li.expense_type}</td>
                                        <td>{editingLineId === li.id ? <input type="date" className="admin-inline-input" value={lineForm.date_of_purchase || ''} onChange={e => setLineForm(p => ({...p, date_of_purchase: e.target.value}))} /> : new Date(li.date_of_purchase).toLocaleDateString('en-GB')}</td>
                                        <td>{editingLineId === li.id ? <input type="number" className="admin-inline-input admin-inline-sm" value={lineForm.amount ?? ''} onChange={e => setLineForm(p => ({...p, amount: +e.target.value}))} /> : `£${Number(li.amount).toFixed(2)}`}</td>
                                        <td>{li.receipt_url ? <a href={li.receipt_url} target="_blank" rel="noopener noreferrer" className="admin-link" title={t('common.view_receipt')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#43a047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg></a> : '—'}</td>
                                        <td className="admin-actions">
                                          {editingLineId === li.id ? (
                                            <>
                                              <button className="admin-btn-sm admin-btn-save" onClick={() => saveLineEdit(li.id, claim.id)}>Save</button>
                                              <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingLineId(null)}>Cancel</button>
                                            </>
                                          ) : (
                                            <>
                                              <button className="admin-btn-icon" onClick={() => startLineEdit(li)}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                              </button>
                                              <button className="admin-btn-icon admin-btn-danger" onClick={() => deleteLineItem(li.id, claim.id)}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                              </button>
                                            </>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : <p className="admin-empty-text">No line items</p>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="admin-empty">No expense claims found</div>}
              {filtered.length > PAGE_SIZE && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
                  <button className="admin-btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                  <span>Page {page} of {totalPages}</span>
                  <button className="admin-btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'chart' && (
        <div className="admin-chart-section">
          <h3>Monthly Expense Totals — FY {fyLabel || '—'}</h3>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#475569' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#22c55e', display: 'inline-block' }} /> Approved
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#475569' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#f59e0b', display: 'inline-block' }} /> Submitted
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#475569' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#ef4444', display: 'inline-block' }} /> Declined
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chartData.months.map(m => {
              const total = m.approved + m.submitted + m.declined
              const approvedPct = chartData.max > 0 ? (m.approved / chartData.max) * 100 : 0
              const submittedPct = chartData.max > 0 ? (m.submitted / chartData.max) * 100 : 0
              const declinedPct = chartData.max > 0 ? (m.declined / chartData.max) * 100 : 0
              return (
                <div key={m.label} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 70px', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textAlign: 'right' }}>{m.label}</span>
                  <div style={{ display: 'flex', height: 22, borderRadius: 4, overflow: 'hidden', background: '#f1f5f9' }}>
                    {m.approved > 0 && <div style={{ width: `${approvedPct}%`, background: '#22c55e', minWidth: 2 }} title={`Approved: £${m.approved.toFixed(2)}`} />}
                    {m.submitted > 0 && <div style={{ width: `${submittedPct}%`, background: '#f59e0b', minWidth: 2 }} title={`Submitted: £${m.submitted.toFixed(2)}`} />}
                    {m.declined > 0 && <div style={{ width: `${declinedPct}%`, background: '#ef4444', minWidth: 2 }} title={`Declined: £${m.declined.toFixed(2)}`} />}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: total > 0 ? '#0f172a' : '#cbd5e1' }}>£{total.toFixed(0)}</span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 20, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>£{chartData.overallTotal.toFixed(2)}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>OVERALL TOTAL</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>£{chartData.totalApproved.toFixed(2)}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>APPROVED</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b' }}>£{chartData.totalSubmitted.toFixed(2)}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>SUBMITTED</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>£{chartData.totalDeclined.toFixed(2)}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>DECLINED</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'exports' && (
        <div className="admin-settings-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Export History</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select value={exportMonth} onChange={e => setExportMonth(e.target.value)} className="admin-select" style={{ minWidth: 130 }}>
                <option value="all">All Months</option>
                {fyMonthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button className="admin-btn-sm admin-btn-save" onClick={exportExpenses} disabled={exporting} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {exporting ? 'Exporting...' : 'Export'}
              </button>
              <button className="admin-btn-sm" onClick={exportXero} disabled={exportingXero} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', background: '#13b5ea', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {exportingXero ? 'Exporting...' : 'Export for Xero'}
              </button>
            </div>
          </div>
          {exportLogs.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Date / Time</th><th>Exported By</th><th>File</th></tr>
                </thead>
                <tbody>
                  {exportLogs.map(log => (
                    <tr key={log.id}>
                      <td>{new Date(log.exported_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(log.exported_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{log.exported_by}</td>
                      <td className="admin-td-mono">{log.file_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-empty">No exports yet</div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="admin-settings-section">
          {settingsLoading ? <div className="admin-loading">Loading settings…</div> : (
            <>
              <div className="admin-settings-group">
                <h3>Cost Centers</h3>
                <div className="admin-tag-list">
                  {costCenters.map(cc => (
                    <div key={cc} className="admin-tag">
                      <span>{cc}</span>
                      <button onClick={async () => {
                        const { error } = await supabase.from('expense_cost_centers').delete().eq('company_id', selectedCompanyId).eq('name', cc)
                        if (error) { showError('Failed to delete cost center: ' + error.message); return }
                        setCostCenters(prev => prev.filter(x => x !== cc))
                        showSuccess('Cost center removed')
                      }}>×</button>
                    </div>
                  ))}
                </div>
                <div className="admin-add-row">
                  <input placeholder="New cost center..." value={newCostCenter} onChange={e => setNewCostCenter(e.target.value)} className="admin-input" />
                  <button className="admin-btn-sm admin-btn-save" onClick={async () => {
                    const name = newCostCenter.trim()
                    if (!name) return
                    if (costCenters.includes(name)) { showError('Cost center already exists'); return }
                    const { error } = await supabase.from('expense_cost_centers').insert({ company_id: selectedCompanyId, name, sort_order: costCenters.length })
                    if (error) { showError('Failed to add cost center: ' + error.message); return }
                    setCostCenters(prev => [...prev, name])
                    setNewCostCenter('')
                    showSuccess('Cost center added')
                  }}>Add</button>
                </div>
              </div>
              <div className="admin-settings-group">
                <h3>Expense Types</h3>
                <div className="admin-tag-list">
                  {expenseTypes.map(et => (
                    <div key={et} className="admin-tag">
                      <span>{et}</span>
                      <button onClick={async () => {
                        const { error } = await supabase.from('expense_expense_types').delete().eq('company_id', selectedCompanyId).eq('name', et)
                        if (error) { showError('Failed to delete expense type: ' + error.message); return }
                        setExpenseTypes(prev => prev.filter(x => x !== et))
                        showSuccess('Expense type removed')
                      }}>×</button>
                    </div>
                  ))}
                </div>
                <div className="admin-add-row">
                  <input placeholder="New expense type..." value={newExpenseType} onChange={e => setNewExpenseType(e.target.value)} className="admin-input" />
                  <button className="admin-btn-sm admin-btn-save" onClick={async () => {
                    const name = newExpenseType.trim()
                    if (!name) return
                    if (expenseTypes.includes(name)) { showError('Expense type already exists'); return }
                    const { error } = await supabase.from('expense_expense_types').insert({ company_id: selectedCompanyId, name, sort_order: expenseTypes.length })
                    if (error) { showError('Failed to add expense type: ' + error.message); return }
                    setExpenseTypes(prev => [...prev, name])
                    setNewExpenseType('')
                    showSuccess('Expense type added')
                  }}>Add</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
