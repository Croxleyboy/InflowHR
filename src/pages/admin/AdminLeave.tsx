import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { sendFeatureEmail } from '../../lib/emailNotifications'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useLanguage } from '../../context/LanguageContext'
import { useToast } from '../../context/ToastContext'
import { formatDate, getFYYear, currencySymbol } from '../../lib/formatters'
import { useAuth } from '../../context/AuthContext'

interface LeaveRequest {
  id: number
  employee_id: string
  start_date: string
  end_date: string
  days_requested: number
  status: string
  reason: string | null
  created_at: string
  leave_type: { name: string } | null
  employee: { first_name: string; last_name: string; email: string; avatar_url: string | null; manager_id: string | null; is_active: boolean } | null
}

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'cancelled']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LEAVE_TYPE_COLOURS: Record<string, string> = {
  'Annual Leave': '#5b9bd5', 'Sick Leave': '#e53935', 'Unpaid Leave': '#ff9800',
  'Compassionate': '#ab47bc', 'Parental': '#26a69a', 'Bereavement': '#78909c',
  'Exam Leave': '#7e57c2', 'Carers Leave': '#ef6c00',
}

const PAGE_SIZE = 30

export default function AdminLeave() {
  const { selectedCompanyId } = useAdminCompany()
  const { company } = useAuth()
  const { t } = useLanguage()
  const { showError } = useToast()
  const currency = company?.currency || 'GBP'
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set())
  const [weekendsAsWorkdays, setWeekendsAsWorkdays] = useState(false)
  const [savingWeekend, setSavingWeekend] = useState(false)
  const [leaveTypeSettings, setLeaveTypeSettings] = useState<{ id: number; name: string; deducts_from_allowance: boolean; max_carry_over_days: number }[]>([])
  const [savingDeduct, setSavingDeduct] = useState<number | null>(null)
  const [savingCarry, setSavingCarry] = useState<number | null>(null)
  const [fyStartMonth, setFyStartMonth] = useState(4)
  const [activeTab, setActiveTab] = useState<'requests' | 'settings' | 'compliance'>('requests')
  const [managerNames, setManagerNames] = useState<Record<string, string>>({})
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [zhHolidayMethod, setZhHolidayMethod] = useState<'accrual' | 'rolled_up'>('rolled_up')
  const [zhAccrualRate, setZhAccrualRate] = useState(12.07)
  const [zhSettingSaving, setZhSettingSaving] = useState(false)
  const [zhAccrualSummary, setZhAccrualSummary] = useState<{ name: string; hours_worked: number; hours_accrued: number; hours_used: number }[]>([])

  const [zhcEnabled, setZhcEnabled] = useState(false)
  const [zhcCancellationHours, setZhcCancellationHours] = useState(48)
  const [zhcPensionThreshold, setZhcPensionThreshold] = useState(10000)
  const [zhcQualifyingWeeks, setZhcQualifyingWeeks] = useState(12)
  const [zhcOvertimeRate, setZhcOvertimeRate] = useState(12.07)
  const [zhcSaving, setZhcSaving] = useState(false)
  const [zhcWorkers, setZhcWorkers] = useState<{ id: string; name: string; start_date: string; weeks: number; avg_hours: number; qualified: boolean; has_request: boolean; guaranteed_hours_approved: boolean }[]>([])
  const [zhcRequests, setZhcRequests] = useState<{ id: number; employee_id: string; employee_name: string; request_date: string; weeks_of_service: number; average_weekly_hours: number; offered_weekly_hours: number | null; status: string; admin_notes: string | null }[]>([])
  const [zhcLoadingCompliance, setZhcLoadingCompliance] = useState(false)
  const [zhcOfferHours, setZhcOfferHours] = useState<Record<number, number>>({})
  const [zhcOfferNotes, setZhcOfferNotes] = useState<Record<number, string>>({})
  const [zhcActionLoading, setZhcActionLoading] = useState<number | null>(null)
  const [zhcCancellations, setZhcCancellations] = useState<{ id: number; employee_name: string; shift_date: string; shift_start: string; shift_end: string; shift_hours: number; notice_hours: number; compensation_amount: number; cancellation_type: string; compensation_included_in_payrun: boolean; cancelled_at: string }[]>([])
  const [zhcPensionWorkers, setZhcPensionWorkers] = useState<{ id: string; name: string; ytd_earnings: number; threshold: number; enrolled: boolean; enrolled_date: string | null }[]>([])

  const loadWeekendSetting = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('companies')
      .select('weekends_as_workdays')
      .eq('id', selectedCompanyId)
      .single()
    setWeekendsAsWorkdays(data?.weekends_as_workdays === true)
  }, [selectedCompanyId])

  async function toggleWeekends() {
    if (!selectedCompanyId) return
    setSavingWeekend(true)
    const newVal = !weekendsAsWorkdays
    const { error } = await supabase.from('companies').update({ weekends_as_workdays: newVal }).eq('id', selectedCompanyId)
    if (error) { showError('Failed to update weekend setting: ' + error.message); setSavingWeekend(false); return }
    setWeekendsAsWorkdays(newVal)
    setSavingWeekend(false)
  }

  const loadLeaveTypeSettings = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('leave_types')
      .select('id, name, deducts_from_allowance, max_carry_over_days')
      .eq('company_id', selectedCompanyId)
      .order('name')
    if (data) setLeaveTypeSettings(data.map(r => ({ ...r, deducts_from_allowance: r.deducts_from_allowance !== false, max_carry_over_days: r.max_carry_over_days ?? 0 })))
  }, [selectedCompanyId])

  async function toggleDeductsFromAllowance(typeId: number, currentVal: boolean) {
    setSavingDeduct(typeId)
    const { error } = await supabase.from('leave_types').update({ deducts_from_allowance: !currentVal }).eq('id', typeId)
    if (error) { showError('Failed to update leave type: ' + error.message); setSavingDeduct(null); return }
    setLeaveTypeSettings(prev => prev.map(t => t.id === typeId ? { ...t, deducts_from_allowance: !currentVal } : t))
    setSavingDeduct(null)
  }

  async function updateCarryOverDays(typeId: number, days: number) {
    setSavingCarry(typeId)
    const { error } = await supabase.from('leave_types').update({ max_carry_over_days: days }).eq('id', typeId)
    if (error) { showError('Failed to update carry-over days: ' + error.message); setSavingCarry(null); return }
    setLeaveTypeSettings(prev => prev.map(t => t.id === typeId ? { ...t, max_carry_over_days: days } : t))
    setSavingCarry(null)
  }

  const loadZhSettings = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data: wts } = await supabase.from('worker_type_settings').select('holiday_pay_method, holiday_accrual_rate').eq('company_id', selectedCompanyId).eq('worker_type', 'zero_hours').maybeSingle()
    if (wts) {
      setZhHolidayMethod((wts.holiday_pay_method as 'accrual' | 'rolled_up') || 'rolled_up')
      setZhAccrualRate(wts.holiday_accrual_rate ?? 12.07)
    }
    const currentYear = new Date().getFullYear()
    const { data: zhEmps } = await supabase.from('employees').select('id, first_name, last_name').eq('company_id', selectedCompanyId).eq('employment_category', 'shift_worker').eq('contract_type', 'Zero hours shift worker').eq('is_active', true)
    if (zhEmps && zhEmps.length > 0) {
      const empIds = zhEmps.map((e: any) => e.id)
      const [{ data: accrualLogs }, { data: balances }] = await Promise.all([
        supabase.from('holiday_accrual_log').select('employee_id, hours_worked, hours_accrued_rounded').eq('company_id', selectedCompanyId).in('employee_id', empIds),
        supabase.from('leave_balances').select('employee_id, total_allowance, used').eq('company_id', selectedCompanyId).eq('year', currentYear).eq('accrual_unit', 'hours').in('employee_id', empIds),
      ])
      const summary = zhEmps.map((e: any) => {
        const empLogs = (accrualLogs || []).filter((l: any) => l.employee_id === e.id)
        const totalWorked = empLogs.reduce((s: number, l: any) => s + Number(l.hours_worked), 0)
        const totalAccrued = empLogs.reduce((s: number, l: any) => s + Number(l.hours_accrued_rounded), 0)
        const bal = (balances || []).find((b: any) => b.employee_id === e.id)
        return { name: `${e.first_name} ${e.last_name}`, hours_worked: Math.round(totalWorked * 100) / 100, hours_accrued: bal ? Number(bal.total_allowance) : totalAccrued, hours_used: bal ? Number(bal.used) : 0 }
      })
      setZhAccrualSummary(summary)
    } else {
      setZhAccrualSummary([])
    }
  }, [selectedCompanyId])

  async function saveZhSettings() {
    if (!selectedCompanyId) return
    setZhSettingSaving(true)
    const { error } = await supabase.from('worker_type_settings').upsert({
      company_id: selectedCompanyId, worker_type: 'zero_hours',
      holiday_pay_method: zhHolidayMethod, holiday_accrual_rate: zhAccrualRate,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,worker_type' })
    if (error) showError('Failed to save: ' + error.message)
    setZhSettingSaving(false)
  }

  const loadZhcSettings = useCallback(async () => {
    if (!selectedCompanyId) return
    const { data } = await supabase.from('zero_hours_compliance_settings').select('*').eq('company_id', selectedCompanyId).maybeSingle()
    if (data) {
      setZhcEnabled(data.enabled ?? false)
      setZhcCancellationHours(data.cancellation_notice_hours ?? 48)
      setZhcPensionThreshold(data.pension_threshold ?? 10000)
      setZhcQualifyingWeeks(data.predictable_hours_qualifying_weeks ?? 12)
      setZhcOvertimeRate(data.guaranteed_hours_overtime_rate ?? 12.07)
    }
  }, [selectedCompanyId])

  async function saveZhcSettings() {
    if (!selectedCompanyId) return
    setZhcSaving(true)
    const { error } = await supabase.from('zero_hours_compliance_settings').upsert({
      company_id: selectedCompanyId,
      enabled: zhcEnabled,
      cancellation_notice_hours: zhcCancellationHours,
      pension_threshold: zhcPensionThreshold,
      predictable_hours_qualifying_weeks: zhcQualifyingWeeks,
      guaranteed_hours_overtime_rate: zhcOvertimeRate,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    if (error) showError('Failed to save: ' + error.message)
    setZhcSaving(false)
  }

  const loadZhcCompliance = useCallback(async () => {
    if (!selectedCompanyId || !zhcEnabled) return
    setZhcLoadingCompliance(true)
    const { data: zhEmps } = await supabase.from('employees')
      .select('id, first_name, last_name, start_date, guaranteed_hours_approved, pension_auto_enrolled, pension_enrolled_date')
      .eq('company_id', selectedCompanyId).eq('employment_category', 'shift_worker')
      .eq('contract_type', 'Zero hours shift worker').eq('is_active', true)
    const { data: existingReqs } = await supabase.from('predictable_hours_requests')
      .select('id, employee_id, request_date, weeks_of_service, average_weekly_hours, offered_weekly_hours, status, admin_notes')
      .eq('company_id', selectedCompanyId).order('created_at', { ascending: false })
    const reqEmployeeIds = new Set((existingReqs || []).map((r: any) => r.employee_id))
    const workers = await Promise.all((zhEmps || []).map(async (e: any) => {
      const { data: weeksData } = await supabase.rpc('get_zero_hours_service_weeks', { p_employee_id: e.id })
      const { data: avgData } = await supabase.rpc('get_zero_hours_avg_weekly_hours', { p_employee_id: e.id, p_weeks: zhcQualifyingWeeks })
      const weeks = typeof weeksData === 'number' ? weeksData : 0
      const avg = typeof avgData === 'number' ? avgData : 0
      return {
        id: e.id,
        name: `${e.first_name} ${e.last_name}`,
        start_date: e.start_date || '',
        weeks,
        avg_hours: avg,
        qualified: weeks >= zhcQualifyingWeeks,
        has_request: reqEmployeeIds.has(e.id),
        guaranteed_hours_approved: e.guaranteed_hours_approved === true,
      }
    }))
    setZhcWorkers(workers)
    const reqRows = (existingReqs || []).map((r: any) => {
      const emp = (zhEmps || []).find((e: any) => e.id === r.employee_id)
      return { ...r, employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown' }
    })
    setZhcRequests(reqRows)
    const { data: cancLogs } = await supabase.from('shift_cancellation_log')
      .select('id, employee_id, shift_date, shift_start, shift_end, shift_hours, notice_hours, compensation_amount, cancellation_type, compensation_included_in_payrun, cancelled_at')
      .eq('company_id', selectedCompanyId).eq('within_notice_window', true)
      .order('cancelled_at', { ascending: false }).limit(50)
    const cancRows = (cancLogs || []).map((c: any) => {
      const emp = (zhEmps || []).find((e: any) => e.id === c.employee_id)
      return { ...c, employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown' }
    })
    setZhcCancellations(cancRows)
    const pensionWorkers = await Promise.all((zhEmps || []).map(async (e: any) => {
      const { data: ytdData } = await supabase.rpc('get_zero_hours_ytd_earnings', { p_employee_id: e.id })
      const ytd = typeof ytdData === 'number' ? ytdData : 0
      return {
        id: e.id,
        name: `${e.first_name} ${e.last_name}`,
        ytd_earnings: ytd,
        threshold: zhcPensionThreshold,
        enrolled: e.pension_auto_enrolled === true,
        enrolled_date: e.pension_enrolled_date || null,
      }
    }))
    setZhcPensionWorkers(pensionWorkers)
    setZhcLoadingCompliance(false)
  }, [selectedCompanyId, zhcEnabled, zhcQualifyingWeeks, zhcPensionThreshold])

  async function zhcCreateOffer(employeeId: string) {
    if (!selectedCompanyId) return
    setZhcActionLoading(-1)
    const worker = zhcWorkers.find(w => w.id === employeeId)
    if (!worker) return
    const { error } = await supabase.from('predictable_hours_requests').insert({
      company_id: selectedCompanyId,
      employee_id: employeeId,
      weeks_of_service: worker.weeks,
      average_weekly_hours: worker.avg_hours,
      status: 'pending',
    })
    if (error) { showError('Failed to create request: ' + error.message); setZhcActionLoading(null); return }
    await loadZhcCompliance()
    setZhcActionLoading(null)
  }

  async function zhcUpdateRequest(reqId: number, newStatus: string) {
    setZhcActionLoading(reqId)
    const updates: Record<string, any> = { status: newStatus, updated_at: new Date().toISOString() }
    if (newStatus === 'offered') {
      updates.offered_weekly_hours = zhcOfferHours[reqId] || 0
      updates.offered_at = new Date().toISOString()
      if (zhcOfferNotes[reqId]) updates.admin_notes = zhcOfferNotes[reqId]
    }
    if (newStatus === 'accepted' || newStatus === 'declined' || newStatus === 'withdrawn') {
      updates.responded_at = new Date().toISOString()
    }
    const { error } = await supabase.from('predictable_hours_requests').update(updates).eq('id', reqId)
    if (error) { showError('Failed to update request: ' + error.message); setZhcActionLoading(null); return }
    if (newStatus === 'accepted') {
      const req = zhcRequests.find(r => r.id === reqId)
      if (req) {
        const weeklyHours = req.offered_weekly_hours || req.average_weekly_hours
        const annualLeaveWeeks = 5.6
        const proRatedLeaveHours = Math.round((weeklyHours * annualLeaveWeeks) * 10) / 10
        await supabase.from('employees').update({
          guaranteed_hours_approved: true,
          guaranteed_weekly_hours: weeklyHours,
          guaranteed_hours_start_date: new Date().toISOString().slice(0, 10),
        }).eq('id', req.employee_id)
        const currentYear = new Date().getFullYear()
        await supabase.from('leave_balances').upsert({
          employee_id: req.employee_id,
          company_id: selectedCompanyId,
          year: currentYear,
          leave_type: 'Annual Leave',
          total_allowance: proRatedLeaveHours,
          used: 0,
          accrual_unit: 'hours',
        }, { onConflict: 'employee_id,company_id,year,leave_type' })
      }
    }
    await loadZhcCompliance()
    setZhcActionLoading(null)
  }

  async function zhcTogglePensionEnrolled(employeeId: string, currentlyEnrolled: boolean) {
    setZhcActionLoading(-2)
    const updates: Record<string, any> = {
      pension_auto_enrolled: !currentlyEnrolled,
    }
    if (!currentlyEnrolled) {
      updates.pension_enrolled_date = new Date().toISOString().slice(0, 10)
    }
    const { error } = await supabase.from('employees').update(updates).eq('id', employeeId)
    if (error) { showError('Failed to update pension status: ' + error.message); setZhcActionLoading(null); return }
    await loadZhcCompliance()
    setZhcActionLoading(null)
  }

  useEffect(() => {
    if (selectedCompanyId) {
      load(); loadWeekendSetting(); loadLeaveTypeSettings(); loadZhSettings(); loadZhcSettings()
      supabase.from('companies').select('fy_start_month').eq('id', selectedCompanyId).single()
        .then(({ data }) => { if (data?.fy_start_month) setFyStartMonth(data.fy_start_month) })
    }
  }, [selectedCompanyId, loadWeekendSetting, loadLeaveTypeSettings, loadZhSettings, loadZhcSettings])

  useEffect(() => {
    if (activeTab === 'compliance' && zhcEnabled && selectedCompanyId) loadZhcCompliance()
  }, [activeTab, zhcEnabled, selectedCompanyId, loadZhcCompliance])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('leave_requests')
      .select('*, leave_type:leave_types(name), employee:employees!leave_requests_employee_id_fkey(first_name, last_name, email, avatar_url, manager_id, is_active)')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    const rows = ((data as LeaveRequest[]) || []).filter(r => r.employee?.is_active !== false)
    setRequests(rows)

    const mgrIds = [...new Set(rows.map(r => r.employee?.manager_id).filter(Boolean))] as string[]
    if (mgrIds.length > 0) {
      const { data: mgrs } = await supabase.from('employees')
        .select('id, first_name, last_name').in('id', mgrIds)
      const names: Record<string, string> = {}
      ;(mgrs || []).forEach((m: { id: string; first_name: string; last_name: string }) => {
        names[m.id] = `${m.first_name} ${m.last_name}`
      })
      setManagerNames(names)
    } else {
      setManagerNames({})
    }

    setLoading(false)
  }

  function startEdit(r: LeaveRequest) {
    setEditingId(r.id)
    setEditForm({ status: r.status, days_requested: r.days_requested, start_date: r.start_date, end_date: r.end_date, reason: r.reason || '' })
  }

  async function saveEdit(id: number) {
    const req = requests.find(r => r.id === id)
    const oldStatus = req?.status
    const newStatus = editForm.status

    if (req && newStatus === 'approved') {
      const typeSetting = leaveTypeSettings.find(t => t.name === req.leave_type?.name)
      if (!typeSetting || typeSetting.deducts_from_allowance) {
        const wasApproved = oldStatus === 'approved'
        const oldDays = Number(req.days_requested)
        const newDays = Number(editForm.days_requested)
        const effectiveDelta = !wasApproved ? newDays : (newDays - oldDays)
        if (effectiveDelta > 0) {
          const year = getFYYear(new Date(req.start_date + 'T00:00:00'), fyStartMonth)
          const { data: balance } = await supabase.from('leave_balances')
            .select('used, total_days').eq('employee_id', req.employee_id).eq('year', year).limit(1).single()
          if (balance) {
            const remaining = balance.total_days - balance.used
            if (effectiveDelta > remaining) {
              const empName = req.employee ? `${req.employee.first_name} ${req.employee.last_name}` : 'This employee'
              const over = (effectiveDelta - remaining).toFixed(1)
              if (!confirm(`${empName} only has ${remaining.toFixed(1)} days remaining but this approval adds ${effectiveDelta.toFixed(1)} days.\n\nThis will exceed their allowance by ${over} days.\n\nProceed anyway?`)) return
            }
          }
        }
      }
    }

    const { error } = await supabase.from('leave_requests').update({
      status: newStatus,
      days_requested: editForm.days_requested,
      start_date: editForm.start_date,
      end_date: editForm.end_date,
      reason: editForm.reason || null,
      approved_at: newStatus === 'approved' ? new Date().toISOString() : null,
    }).eq('id', id)
    if (error) { showError('Failed to update leave request: ' + error.message); return }

    if (req) {
      const typeSetting = leaveTypeSettings.find(t => t.name === req.leave_type?.name)
      if (!typeSetting || typeSetting.deducts_from_allowance) {
        const wasApproved = oldStatus === 'approved'
        const nowApproved = newStatus === 'approved'
        const oldDays = Number(req.days_requested)
        const newDays = Number(editForm.days_requested)
        let delta = 0
        if (!wasApproved && nowApproved) delta = newDays
        else if (wasApproved && !nowApproved) delta = -oldDays
        else if (wasApproved && nowApproved && oldDays !== newDays) delta = newDays - oldDays

        if (delta !== 0) {
          const year = getFYYear(new Date(req.start_date + 'T00:00:00'), fyStartMonth)
          await supabase.rpc('adjust_leave_balance', {
            p_employee_id: req.employee_id,
            p_year: year,
            p_delta: delta,
          })
        }
      }
    }

    if (req && oldStatus === 'pending' && (newStatus === 'approved' || newStatus === 'rejected')) {
      const empName = req.employee ? `${req.employee.first_name} ${req.employee.last_name}` : ''
      const empEmail = req.employee?.email || ''
      const typeName = req.leave_type?.name || 'Leave'
      const approved = newStatus === 'approved'
      const now = new Date().toISOString()
      const dateRange = `${formatDate(editForm.start_date || req.start_date)} to ${formatDate(editForm.end_date || req.end_date)}`

      const { data: pendingWf } = await supabase.from('workflow_tracker')
        .select('assigned_to')
        .eq('record_type', 'Leave').eq('approval_id', id).eq('status', 'Pending')
        .eq('company_id', selectedCompanyId).limit(1).maybeSingle()
      const approverEmail = pendingWf?.assigned_to || ''

      await supabase.from('workflow_tracker').update({
        status: 'Complete',
        approval_status: approved ? 'Approved' : 'Declined',
        updated_at: now,
        task_description: approved
          ? `${typeName} approved - ${dateRange}`
          : `${typeName} declined`,
      }).eq('record_type', 'Leave').eq('approval_id', id).eq('status', 'Pending').eq('company_id', selectedCompanyId)

      await supabase.from('workflow_tracker').insert({
        emp_display_name: empName,
        step: 2, status: 'Complete', record_type: 'Leave',
        action: approved ? 'Leave approved' : 'Leave declined',
        employee_email: empEmail, assigned_to: empEmail,
        approval_id: id, reminder_count: 1,
        task_description: approved
          ? `Your ${typeName} from ${dateRange} has been approved by admin.`
          : `Your ${typeName} request from ${dateRange} has been declined by admin. Please contact your manager.`,
        approval_status: approved ? 'Approved' : 'Declined',
        company_id: selectedCompanyId,
      })

      if (approverEmail) {
        await supabase.from('workflow_tracker').insert({
          emp_display_name: 'Admin',
          step: 2, status: 'Complete', record_type: 'Leave',
          action: approved ? 'Leave approved by admin' : 'Leave declined by admin',
          employee_email: approverEmail, assigned_to: approverEmail,
          approval_id: id, reminder_count: 1,
          task_description: `Admin ${approved ? 'approved' : 'declined'} ${typeName} for ${empName} - ${dateRange}`,
          approval_status: approved ? 'Approved' : 'Declined',
          company_id: selectedCompanyId,
        })
      }

      if (selectedCompanyId) {
        sendFeatureEmail({
          companyId: selectedCompanyId,
          employeeId: req.employee_id,
          featureKey: 'leave_enabled',
          title: approved ? `${typeName} Approved` : `${typeName} Declined`,
          message: approved
            ? `Your ${typeName} from ${dateRange} (${editForm.days_requested || req.days_requested} days) has been approved.`
            : `Your ${typeName} request from ${dateRange} has been declined. Please contact your manager.`,
          type: approved ? 'info' : 'alert',
          link: '/leave',
        })
      }

      window.dispatchEvent(new Event('notifications-updated'))
    }

    setEditingId(null)
    load()
  }

  async function quickApproveDecline(id: number, action: 'approved' | 'rejected') {
    const req = requests.find(r => r.id === id)
    if (!req || req.status !== 'pending') return

    if (action === 'approved') {
      const typeSetting = leaveTypeSettings.find(t => t.name === req.leave_type?.name)
      if (!typeSetting || typeSetting.deducts_from_allowance) {
        const year = getFYYear(new Date(req.start_date + 'T00:00:00'), fyStartMonth)
        const { data: balance } = await supabase.from('leave_balances')
          .select('used, total_days').eq('employee_id', req.employee_id).eq('year', year).limit(1).single()
        if (balance) {
          const remaining = balance.total_days - balance.used
          const daysReq = Number(req.days_requested)
          if (daysReq > remaining) {
            const empName = req.employee ? `${req.employee.first_name} ${req.employee.last_name}` : 'This employee'
            const over = (daysReq - remaining).toFixed(1)
            if (!confirm(`${empName} only has ${remaining.toFixed(1)} days remaining but is requesting ${daysReq.toFixed(1)} days.\n\nApproving will exceed their allowance by ${over} days.\n\nProceed anyway?`)) return
          }
        }
      }
    }

    const { error } = await supabase.from('leave_requests').update({
      status: action,
      approved_at: action === 'approved' ? new Date().toISOString() : null,
    }).eq('id', id)
    if (error) { showError('Failed to update: ' + error.message); return }

    if (action === 'approved') {
      const typeSetting = leaveTypeSettings.find(t => t.name === req.leave_type?.name)
      if (!typeSetting || typeSetting.deducts_from_allowance) {
        const year = getFYYear(new Date(req.start_date + 'T00:00:00'), fyStartMonth)
        await supabase.rpc('adjust_leave_balance', {
          p_employee_id: req.employee_id,
          p_year: year,
          p_delta: Number(req.days_requested),
        })
      }
    }

    const empName = req.employee ? `${req.employee.first_name} ${req.employee.last_name}` : ''
    const empEmail = req.employee?.email || ''
    const typeName = req.leave_type?.name || 'Leave'
    const approved = action === 'approved'
    const now = new Date().toISOString()
    const dateRange = `${formatDate(req.start_date)} to ${formatDate(req.end_date)}`

    await supabase.from('workflow_tracker').update({
      status: 'Complete',
      approval_status: approved ? 'Approved' : 'Declined',
      updated_at: now,
      task_description: approved ? `${typeName} approved - ${dateRange}` : `${typeName} declined`,
    }).eq('record_type', 'Leave').eq('approval_id', id).eq('status', 'Pending').eq('company_id', selectedCompanyId)

    await supabase.from('workflow_tracker').insert({
      emp_display_name: empName, step: 2, status: 'Complete', record_type: 'Leave',
      action: approved ? 'Leave approved' : 'Leave declined',
      employee_email: empEmail, assigned_to: empEmail,
      approval_id: id, reminder_count: 1,
      task_description: approved
        ? `Your ${typeName} from ${dateRange} has been approved.`
        : `Your ${typeName} request from ${dateRange} has been declined. Please contact your manager.`,
      approval_status: approved ? 'Approved' : 'Declined',
      company_id: selectedCompanyId,
    })

    if (selectedCompanyId) {
      sendFeatureEmail({
        companyId: selectedCompanyId, employeeId: req.employee_id, featureKey: 'leave_enabled',
        title: approved ? `${typeName} Approved` : `${typeName} Declined`,
        message: approved
          ? `Your ${typeName} from ${dateRange} (${req.days_requested} days) has been approved.`
          : `Your ${typeName} request from ${dateRange} has been declined. Please contact your manager.`,
        type: approved ? 'info' : 'alert', link: '/leave',
      })
    }

    window.dispatchEvent(new Event('notifications-updated'))
    load()
  }

  async function deleteRequest(id: number) {
    if (!confirm('Delete this leave request?')) return

    const req = requests.find(r => r.id === id)

    if (req && req.status === 'approved') {
      const typeSetting = leaveTypeSettings.find(t => t.name === req.leave_type?.name)
      if (!typeSetting || typeSetting.deducts_from_allowance) {
        const year = getFYYear(new Date(req.start_date + 'T00:00:00'), fyStartMonth)
        await supabase.rpc('adjust_leave_balance', {
          p_employee_id: req.employee_id,
          p_year: year,
          p_delta: -Number(req.days_requested),
        })
      }
    }

    const { error } = await supabase.from('leave_requests').delete().eq('id', id)
    if (error) { showError('Failed to delete leave request: ' + error.message); return }

    if (req) {
      const empName = req.employee ? `${req.employee.first_name} ${req.employee.last_name}` : ''
      const typeName = req.leave_type?.name || 'Leave'
      const dateRange = `${formatDate(req.start_date)} to ${formatDate(req.end_date)}`

      await supabase.from('workflow_tracker')
        .update({ status: 'Complete', approval_status: 'Deleted' })
        .eq('approval_id', id)
        .eq('record_type', 'Leave')
        .eq('status', 'Pending')
        .eq('company_id', selectedCompanyId)

      await supabase.from('notifications').insert({
        employee_id: req.employee_id,
        title: `${typeName} request deleted`,
        message: `Your ${typeName} request for ${dateRange} (${req.days_requested} days) has been deleted by an administrator.`,
        type: 'warning',
        link: '/leave',
        is_read: false,
        company_id: selectedCompanyId,
      })

      await supabase.from('workflow_tracker').insert({
        emp_display_name: empName,
        step: 1,
        status: 'Complete',
        record_type: 'Leave',
        action: 'Leave request deleted',
        employee_email: req.employee?.email || '',
        assigned_to: req.employee?.email || '',
        approval_id: id,
        reminder_count: 0,
        task_description: `${typeName} request for ${dateRange} has been deleted by an administrator.`,
        approval_status: 'Deleted',
        company_id: selectedCompanyId,
      })

      window.dispatchEvent(new Event('notifications-updated'))
    }

    setRequests(prev => prev.filter(r => r.id !== id))
  }

  async function bulkDeleteRequests() {
    if (selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} selected leave request${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkDeleting(true)
    for (const id of selectedIds) {
      await deleteRequest(id)
    }
    setSelectedIds(new Set())
    setBulkDeleting(false)
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleExpandEmployee(employeeId: string) {
    setExpandedEmployees(prev => {
      const next = new Set(prev)
      if (next.has(employeeId)) next.delete(employeeId)
      else next.add(employeeId)
      return next
    })
  }

  const employees = useMemo(() => {
    const names = new Set<string>()
    requests.forEach(r => { if (r.employee) names.add(`${r.employee.first_name} ${r.employee.last_name}`) })
    return Array.from(names).sort()
  }, [requests])

  const filtered = useMemo(() => {
    setPage(1)
    return requests.filter(r => {
      if (filterStatus && r.status !== filterStatus) return false
      if (filterEmployee && r.employee && `${r.employee.first_name} ${r.employee.last_name}` !== filterEmployee) return false
      if (search) {
        const q = search.toLowerCase()
        const name = r.employee ? `${r.employee.first_name} ${r.employee.last_name}`.toLowerCase() : ''
        const type = (r.leave_type?.name || '').toLowerCase()
        const status = r.status.toLowerCase()
        const reason = (r.reason || '').toLowerCase()
        if (!name.includes(q) && !type.includes(q) && !status.includes(q) && !reason.includes(q)) return false
      }
      return true
    })
  }, [requests, filterStatus, filterEmployee, search])

  interface EmployeeGroup {
    employeeId: string
    name: string
    avatar_url: string | null
    managerId: string | null
    requests: LeaveRequest[]
    latestCreatedAt: string
    pendingCount: number
    approvedCount: number
  }

  const grouped = useMemo<EmployeeGroup[]>(() => {
    const map = new Map<string, EmployeeGroup>()
    for (const r of filtered) {
      if (!r.employee) continue
      const key = r.employee_id
      let g = map.get(key)
      if (!g) {
        g = {
          employeeId: key,
          name: `${r.employee.first_name} ${r.employee.last_name}`,
          avatar_url: r.employee.avatar_url,
          managerId: r.employee.manager_id,
          requests: [],
          latestCreatedAt: r.created_at,
          pendingCount: 0,
          approvedCount: 0,
        }
        map.set(key, g)
      }
      g.requests.push(r)
      if (r.created_at > g.latestCreatedAt) g.latestCreatedAt = r.created_at
      if (r.status === 'pending') g.pendingCount++
      if (r.status === 'approved') g.approvedCount++
    }
    return Array.from(map.values()).sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt))
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE))
  const paginatedGroups = grouped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
    totalDays: requests.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.days_requested), 0),
  }), [requests])

  const chartData = useMemo(() => {
    const fyMonths: number[] = []
    for (let i = 0; i < 12; i++) fyMonths.push((fyStartMonth - 1 + i) % 12)

    const now = new Date()
    const fyYear = getFYYear(now, fyStartMonth)

    const approved = requests.filter(r => r.status === 'approved')
    const monthData: { month: number; label: string; byType: Record<string, number>; total: number }[] = fyMonths.map(m => ({
      month: m, label: MONTH_LABELS[m], byType: {}, total: 0,
    }))

    for (const r of approved) {
      const startD = new Date(r.start_date + 'T00:00:00')
      const startMonth = startD.getMonth()

      const fyStartDate = new Date(fyYear, fyStartMonth - 1, 1)
      const fyEndDate = new Date(fyYear + 1, fyStartMonth - 1, 0)
      if (startD < fyStartDate || startD > fyEndDate) continue

      const idx = fyMonths.indexOf(startMonth)
      if (idx === -1) continue
      const typeName = r.leave_type?.name || 'Other'
      const days = Number(r.days_requested) || 0
      monthData[idx].byType[typeName] = (monthData[idx].byType[typeName] || 0) + days
      monthData[idx].total += days
    }

    const maxTotal = Math.max(...monthData.map(d => d.total), 1)
    const leaveTypes = Array.from(new Set(approved.map(r => r.leave_type?.name || 'Other')))

    const fyLabel = `${MONTH_LABELS[fyStartMonth - 1]} ${fyYear} – ${MONTH_LABELS[(fyStartMonth - 2 + 12) % 12]} ${fyYear + 1}`

    return { monthData, maxTotal, leaveTypes, fyLabel }
  }, [requests, fyStartMonth])

  return (
    <div className="admin-section">
      <div className="admin-page-header">
        <h2>Leave Management</h2>
        <p>{requests.length} total requests</p>
      </div>

      <div className="admin-mini-stats">
        <div className="admin-mini-stat"><span className="admin-mini-value">{stats.total}</span><span>Total</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#ff9800'}}>{stats.pending}</span><span>Pending</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#43a047'}}>{stats.approved}</span><span>Approved</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#e53935'}}>{stats.rejected}</span><span>Rejected</span></div>
        <div className="admin-mini-stat"><span className="admin-mini-value" style={{color:'#5b9bd5'}}>{stats.totalDays}</span><span>Days Used</span></div>
      </div>

      <div className="admin-tabs">
        <button className={`admin-tab${activeTab === 'requests' ? ' active' : ''}`} onClick={() => setActiveTab('requests')}>Leave Requests</button>
        <button className={`admin-tab${activeTab === 'settings' ? ' active' : ''}`} onClick={() => setActiveTab('settings')}>Settings</button>
        {zhcEnabled && (
          <button className={`admin-tab${activeTab === 'compliance' ? ' active' : ''}`} onClick={() => setActiveTab('compliance')}>
            Zero Hours Compliance
          </button>
        )}
      </div>

      {activeTab === 'requests' && !loading && chartData.monthData.some(d => d.total > 0) && (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 10, padding: '16px 16px 12px', marginBottom: 16, border: '1px solid var(--border-color, #e0e0e0)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Approved Leave Distribution</h3>
            <span style={{ fontSize: 12, color: '#888' }}>{chartData.fyLabel}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160, overflowX: 'auto' }}>
            {chartData.monthData.map((d, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                {d.total > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 600, marginBottom: 2, color: 'var(--text-color, #333)' }}>{d.total}</span>
                )}
                <div style={{ width: '100%', maxWidth: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}>
                  {chartData.leaveTypes.map(type => {
                    const val = d.byType[type] || 0
                    if (val === 0) return null
                    const pct = (val / chartData.maxTotal) * 140
                    return (
                      <div
                        key={type}
                        title={`${type}: ${val} day${val !== 1 ? 's' : ''}`}
                        style={{
                          height: pct,
                          background: LEAVE_TYPE_COLOURS[type] || '#90a4ae',
                          minHeight: val > 0 ? 3 : 0,
                        }}
                      />
                    )
                  })}
                </div>
                <span style={{ fontSize: 11, marginTop: 4, color: '#888' }}>{d.label}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10 }}>
            {chartData.leaveTypes.map(type => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#666' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: LEAVE_TYPE_COLOURS[type] || '#90a4ae', flexShrink: 0 }} />
                {type}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <>
          <div className="admin-weekend-toggle">
            <label className="admin-toggle-label">
              <input
                type="checkbox"
                checked={weekendsAsWorkdays}
                onChange={toggleWeekends}
                disabled={savingWeekend}
              />
              <span>Count weekends as working days</span>
            </label>
            <span className="admin-toggle-hint">
              {weekendsAsWorkdays
                ? 'Weekends will be included when employees request leave'
                : 'Weekends are excluded from leave day calculations (UK bank holidays always excluded)'}
            </span>
          </div>

          {leaveTypeSettings.length > 0 && (
            <div className="admin-weekend-toggle" style={{ marginTop: 12 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>{t('leave.deductions_title')}</h4>
              <span className="admin-toggle-hint" style={{ marginBottom: 12, display: 'block' }}>
                {t('leave.deductions_hint')}
              </span>
              {leaveTypeSettings.filter(lt => ['Sick Leave', 'Jury Duty', 'Compassionate Leave', 'Bereavement', 'Exam Leave', 'Carers Leave'].includes(lt.name)).map(lt => (
                  <label key={lt.id} className="admin-toggle-label" style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={lt.deducts_from_allowance}
                      onChange={() => toggleDeductsFromAllowance(lt.id, lt.deducts_from_allowance)}
                      disabled={savingDeduct === lt.id}
                    />
                    <span>{lt.name} — {lt.deducts_from_allowance ? t('leave.deducts_from_allowance') : t('leave.does_not_deduct')}</span>
                  </label>
                ))}
            </div>
          )}

          {leaveTypeSettings.length > 0 && (
            <div className="admin-weekend-toggle" style={{ marginTop: 12 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Carry-Over Days</h4>
              <span className="admin-toggle-hint" style={{ marginBottom: 12, display: 'block' }}>
                Set the maximum number of unused leave days that can be carried over into the next financial year per leave type. Set to 0 for no carry-over.
              </span>
              {leaveTypeSettings.filter(lt => lt.deducts_from_allowance).map(lt => (
                <div key={lt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 140, fontSize: 13 }}>{lt.name}</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    className="admin-inline-input admin-inline-sm"
                    value={lt.max_carry_over_days}
                    onChange={e => {
                      const val = Math.max(0, Number(e.target.value) || 0)
                      setLeaveTypeSettings(prev => prev.map(t => t.id === lt.id ? { ...t, max_carry_over_days: val } : t))
                    }}
                    onBlur={e => updateCarryOverDays(lt.id, Math.max(0, Number(e.target.value) || 0))}
                    disabled={savingCarry === lt.id}
                    style={{ width: 70, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 12, color: '#888' }}>days max</span>
                </div>
              ))}
            </div>
          )}

          <div className="admin-weekend-toggle" style={{ marginTop: 20, padding: 16, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Zero Hours Holiday Accrual</h4>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#dbeafe', color: '#1e40af', fontWeight: 600 }}>UK Statutory</span>
            </div>
            <p style={{ fontSize: 12, color: '#374151', margin: '0 0 14px', lineHeight: 1.5 }}>
              Under UK Working Time Regulations 1998 (amended 2024), zero hours workers accrue paid holiday based on hours worked. The statutory minimum is 5.6 weeks (12.07% of hours worked).
            </p>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
              <div className="admin-form-field" style={{ flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>Holiday Pay Method</label>
                <select className="admin-select" value={zhHolidayMethod} onChange={e => setZhHolidayMethod(e.target.value as 'accrual' | 'rolled_up')}>
                  <option value="rolled_up">Rolled-up Holiday Pay (paid on each payslip)</option>
                  <option value="accrual">Accrual (workers take paid leave)</option>
                </select>
              </div>
              <div className="admin-form-field" style={{ minWidth: 140 }}>
                <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>Accrual Rate (%)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input className="admin-inline-input" type="number" step="0.01" min="12.07" max="30" value={zhAccrualRate} onChange={e => setZhAccrualRate(parseFloat(e.target.value) || 12.07)} style={{ width: 80, textAlign: 'center' }} />
                  <span style={{ fontSize: 11, color: '#6b7280' }}>min 12.07%</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="admin-btn admin-btn-primary" disabled={zhSettingSaving} onClick={saveZhSettings} style={{ fontSize: 12 }}>
                  {zhSettingSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            {zhAccrualSummary.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <h5 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600 }}>Current Accrual Summary</h5>
                <table className="admin-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th style={{ textAlign: 'right' }}>Hours Worked</th>
                      <th style={{ textAlign: 'right' }}>Hours Accrued</th>
                      <th style={{ textAlign: 'right' }}>Hours Used</th>
                      <th style={{ textAlign: 'right' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zhAccrualSummary.map(row => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td style={{ textAlign: 'right' }}>{row.hours_worked.toFixed(1)}</td>
                        <td style={{ textAlign: 'right' }}>{row.hours_accrued.toFixed(1)}</td>
                        <td style={{ textAlign: 'right' }}>{row.hours_used.toFixed(1)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{(row.hours_accrued - row.hours_used).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {zhAccrualSummary.length === 0 && (
              <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>No zero hours workers found in this company.</p>
            )}
          </div>

          {/* Zero Hours Compliance Engine */}
          <div style={{ marginTop: 20, padding: 16, background: zhcEnabled ? '#fef3c7' : '#f9fafb', borderRadius: 8, border: `1px solid ${zhcEnabled ? '#f59e0b' : '#e5e7eb'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Zero Hours Compliance Engine</h4>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>Employment Rights Act 2024</span>
            </div>
            <p style={{ fontSize: 12, color: '#374151', margin: '0 0 14px', lineHeight: 1.5 }}>
              Enables monitoring and enforcement of UK zero hours worker protections: right to request predictable hours (after a qualifying period), shift cancellation compensation, and pension auto-enrolment tracking. When switched off, none of these features are active.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={zhcEnabled} onChange={e => setZhcEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#f59e0b' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{zhcEnabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>

            {zhcEnabled && (
              <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
                  <div className="admin-form-field" style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>Predictable Hours Qualifying Period</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input className="admin-inline-input" type="number" min="4" max="52" value={zhcQualifyingWeeks} onChange={e => setZhcQualifyingWeeks(parseInt(e.target.value) || 12)} style={{ width: 60, textAlign: 'center' }} />
                      <span style={{ fontSize: 11, color: '#6b7280' }}>weeks (statutory: 12 weeks)</span>
                    </div>
                  </div>
                  <div className="admin-form-field" style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>Shift Cancellation Notice Period</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <select className="admin-select" value={zhcCancellationHours} onChange={e => setZhcCancellationHours(parseInt(e.target.value))}>
                        <option value={24}>24 hours (1 day)</option>
                        <option value={48}>48 hours (2 days)</option>
                        <option value={72}>72 hours (3 days)</option>
                        <option value={96}>96 hours (4 days)</option>
                        <option value={120}>120 hours (5 days)</option>
                        <option value={144}>144 hours (6 days)</option>
                        <option value={168}>168 hours (7 days)</option>
                      </select>
                    </div>
                    <span style={{ fontSize: 10, color: '#6b7280', marginTop: 2, display: 'block' }}>Cancellations within this window trigger compensation</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
                  <div className="admin-form-field" style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>Pension Auto-Enrolment Threshold</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12 }}>{currencySymbol(currency)}</span>
                      <input className="admin-inline-input" type="number" min="0" step="100" value={zhcPensionThreshold} onChange={e => setZhcPensionThreshold(parseFloat(e.target.value) || 10000)} style={{ width: 100, textAlign: 'center' }} />
                      <span style={{ fontSize: 11, color: '#6b7280' }}>per year (statutory: {currencySymbol(currency)}10,000)</span>
                    </div>
                  </div>
                  <div className="admin-form-field" style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>Guaranteed Hours Overtime Rate</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input className="admin-inline-input" type="number" step="0.01" min="0" max="30" value={zhcOvertimeRate} onChange={e => setZhcOvertimeRate(parseFloat(e.target.value) || 12.07)} style={{ width: 80, textAlign: 'center' }} />
                      <span style={{ fontSize: 11, color: '#6b7280' }}>% (hours above guaranteed weekly hours)</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="admin-btn admin-btn-primary" disabled={zhcSaving} onClick={saveZhcSettings} style={{ fontSize: 12 }}>
                    {zhcSaving ? 'Saving...' : 'Save Compliance Settings'}
                  </button>
                </div>
              </>
            )}

            {!zhcEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <button className="admin-btn admin-btn-primary" disabled={zhcSaving} onClick={() => { setZhcEnabled(true) }} style={{ fontSize: 12 }}>
                  Enable Compliance Engine
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'compliance' && zhcEnabled && (
        <>
          {zhcLoadingCompliance && <div style={{ padding: 20, textAlign: 'center', color: '#6b7280' }}>Loading compliance data…</div>}

          {!zhcLoadingCompliance && (
            <>
              <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Predictable Hours Monitoring</h4>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>Employment Rights Act 2024</span>
                </div>
                <p style={{ fontSize: 12, color: '#374151', margin: '0 0 14px', lineHeight: 1.5 }}>
                  Zero hours workers who have completed {zhcQualifyingWeeks} weeks of service are entitled to request predictable hours.
                  Workers shown as "Qualified" below have met the qualifying period and should be offered a predictable hours contract.
                </p>

                {zhcWorkers.length === 0 && (
                  <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>No zero hours workers found.</p>
                )}

                {zhcWorkers.length > 0 && (
                  <table className="admin-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Start Date</th>
                        <th style={{ textAlign: 'right' }}>Weeks of Service</th>
                        <th style={{ textAlign: 'right' }}>Avg Weekly Hours</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zhcWorkers.map(w => (
                        <tr key={w.id} style={w.qualified ? { background: '#fefce8' } : undefined}>
                          <td style={{ fontWeight: 500 }}>{w.name}</td>
                          <td>{w.start_date ? formatDate(w.start_date) : '—'}</td>
                          <td style={{ textAlign: 'right' }}>{w.weeks}</td>
                          <td style={{ textAlign: 'right' }}>{w.avg_hours.toFixed(1)}</td>
                          <td>
                            {w.guaranteed_hours_approved ? (
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#d1fae5', color: '#065f46', fontWeight: 600 }}>Guaranteed Hours</span>
                            ) : w.qualified ? (
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>Qualified</span>
                            ) : (
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f3f4f6', color: '#6b7280', fontWeight: 500 }}>
                                {zhcQualifyingWeeks - w.weeks} weeks remaining
                              </span>
                            )}
                          </td>
                          <td>
                            {w.qualified && !w.has_request && !w.guaranteed_hours_approved && (
                              <button
                                className="admin-btn admin-btn-primary"
                                style={{ fontSize: 11, padding: '4px 10px' }}
                                disabled={zhcActionLoading !== null}
                                onClick={() => zhcCreateOffer(w.id)}
                              >
                                {zhcActionLoading === -1 ? 'Creating…' : 'Create Request'}
                              </button>
                            )}
                            {w.has_request && !w.guaranteed_hours_approved && (
                              <span style={{ fontSize: 11, color: '#6b7280' }}>Request exists — see below</span>
                            )}
                            {w.guaranteed_hours_approved && (
                              <span style={{ fontSize: 11, color: '#065f46' }}>Transitioned</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {zhcCancellations.length > 0 && (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Shift Cancellation Compensation Log</h4>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 10px' }}>
                    Shifts cancelled within the notice window. Compensation amounts are included in the next payrun.
                  </p>
                  <table className="admin-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Shift Date</th>
                        <th>Shift Time</th>
                        <th style={{ textAlign: 'right' }}>Hours</th>
                        <th style={{ textAlign: 'right' }}>Notice (hrs)</th>
                        <th style={{ textAlign: 'right' }}>Compensation</th>
                        <th>Type</th>
                        <th>Payrun</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zhcCancellations.map(c => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 500 }}>{c.employee_name}</td>
                          <td>{formatDate(c.shift_date)}</td>
                          <td>{c.shift_start?.substring(0, 5)} – {c.shift_end?.substring(0, 5)}</td>
                          <td style={{ textAlign: 'right' }}>{Number(c.shift_hours).toFixed(1)}</td>
                          <td style={{ textAlign: 'right' }}>{Number(c.notice_hours).toFixed(0)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{currencySymbol(currency)}{Number(c.compensation_amount).toFixed(2)}</td>
                          <td>
                            <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 8, background: '#fee2e2', color: '#991b1b' }}>
                              {c.cancellation_type}
                            </span>
                          </td>
                          <td>
                            {c.compensation_included_in_payrun ? (
                              <span style={{ fontSize: 11, color: '#059669' }}>Included</span>
                            ) : (
                              <span style={{ fontSize: 11, color: '#d97706' }}>Pending</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {zhcPensionWorkers.length > 0 && (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Pension Auto-Enrolment Monitoring</h4>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#ede9fe', color: '#5b21b6', fontWeight: 600 }}>Workplace Pensions</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 10px' }}>
                    Zero hours workers earning above {currencySymbol(currency)}{zhcPensionThreshold.toLocaleString()} per year must be auto-enrolled into a workplace pension.
                    Mark workers as enrolled once their pension has been set up with your pension provider.
                  </p>
                  <table className="admin-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th style={{ textAlign: 'right' }}>YTD Earnings</th>
                        <th style={{ textAlign: 'right' }}>Threshold</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zhcPensionWorkers.map(pw => {
                        const aboveThreshold = pw.ytd_earnings >= pw.threshold
                        return (
                          <tr key={pw.id} style={aboveThreshold && !pw.enrolled ? { background: '#fef2f2' } : undefined}>
                            <td style={{ fontWeight: 500 }}>{pw.name}</td>
                            <td style={{ textAlign: 'right' }}>{currencySymbol(currency)}{pw.ytd_earnings.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right' }}>{currencySymbol(currency)}{pw.threshold.toLocaleString()}</td>
                            <td>
                              {pw.enrolled ? (
                                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#d1fae5', color: '#065f46', fontWeight: 600 }}>
                                  Enrolled{pw.enrolled_date ? ` (${formatDate(pw.enrolled_date)})` : ''}
                                </span>
                              ) : aboveThreshold ? (
                                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>Action Required</span>
                              ) : (
                                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f3f4f6', color: '#6b7280', fontWeight: 500 }}>
                                  Below threshold ({Math.round((pw.ytd_earnings / pw.threshold) * 100)}%)
                                </span>
                              )}
                            </td>
                            <td>
                              {!pw.enrolled && aboveThreshold && (
                                <button
                                  className="admin-btn admin-btn-primary"
                                  style={{ fontSize: 11, padding: '4px 10px' }}
                                  disabled={zhcActionLoading === -2}
                                  onClick={() => zhcTogglePensionEnrolled(pw.id, false)}
                                >
                                  Mark as Enrolled
                                </button>
                              )}
                              {pw.enrolled && (
                                <button
                                  className="admin-btn"
                                  style={{ fontSize: 11, padding: '4px 10px', background: '#f3f4f6', color: '#6b7280' }}
                                  disabled={zhcActionLoading === -2}
                                  onClick={() => zhcTogglePensionEnrolled(pw.id, true)}
                                >
                                  Unenrol
                                </button>
                              )}
                              {!pw.enrolled && !aboveThreshold && (
                                <span style={{ fontSize: 11, color: '#9ca3af' }}>Monitoring</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {zhcRequests.length > 0 && (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Predictable Hours Requests</h4>
                  <table className="admin-table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Request Date</th>
                        <th style={{ textAlign: 'right' }}>Service Weeks</th>
                        <th style={{ textAlign: 'right' }}>Avg Hours</th>
                        <th style={{ textAlign: 'right' }}>Offered Hours</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zhcRequests.map(req => (
                        <tr key={req.id}>
                          <td style={{ fontWeight: 500 }}>{req.employee_name}</td>
                          <td>{formatDate(req.request_date)}</td>
                          <td style={{ textAlign: 'right' }}>{req.weeks_of_service}</td>
                          <td style={{ textAlign: 'right' }}>{Number(req.average_weekly_hours).toFixed(1)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {req.status === 'pending' ? (
                              <input
                                className="admin-inline-input"
                                type="number"
                                step="0.5"
                                min="1"
                                max="48"
                                value={zhcOfferHours[req.id] ?? Math.round(Number(req.average_weekly_hours))}
                                onChange={e => setZhcOfferHours(prev => ({ ...prev, [req.id]: parseFloat(e.target.value) || 0 }))}
                                style={{ width: 60, textAlign: 'center' }}
                              />
                            ) : (
                              req.offered_weekly_hours ? `${Number(req.offered_weekly_hours).toFixed(1)}` : '—'
                            )}
                          </td>
                          <td>
                            <span style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                              background: req.status === 'accepted' ? '#d1fae5' : req.status === 'offered' ? '#dbeafe' : req.status === 'declined' ? '#fee2e2' : req.status === 'withdrawn' ? '#f3f4f6' : '#fef3c7',
                              color: req.status === 'accepted' ? '#065f46' : req.status === 'offered' ? '#1e40af' : req.status === 'declined' ? '#991b1b' : req.status === 'withdrawn' ? '#6b7280' : '#92400e',
                            }}>
                              {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                            </span>
                          </td>
                          <td>
                            {req.status === 'pending' && (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                  className="admin-inline-input"
                                  type="text"
                                  placeholder="Notes (optional)"
                                  value={zhcOfferNotes[req.id] || ''}
                                  onChange={e => setZhcOfferNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                                  style={{ width: 120, fontSize: 11 }}
                                />
                                <button
                                  className="admin-btn admin-btn-primary"
                                  style={{ fontSize: 11, padding: '3px 8px' }}
                                  disabled={zhcActionLoading === req.id}
                                  onClick={() => zhcUpdateRequest(req.id, 'offered')}
                                >
                                  Send Offer
                                </button>
                                <button
                                  className="admin-btn"
                                  style={{ fontSize: 11, padding: '3px 8px', background: '#fee2e2', color: '#991b1b' }}
                                  disabled={zhcActionLoading === req.id}
                                  onClick={() => zhcUpdateRequest(req.id, 'withdrawn')}
                                >
                                  Withdraw
                                </button>
                              </div>
                            )}
                            {req.status === 'offered' && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  className="admin-btn admin-btn-primary"
                                  style={{ fontSize: 11, padding: '3px 8px', background: '#059669' }}
                                  disabled={zhcActionLoading === req.id}
                                  onClick={() => zhcUpdateRequest(req.id, 'accepted')}
                                >
                                  Accept
                                </button>
                                <button
                                  className="admin-btn"
                                  style={{ fontSize: 11, padding: '3px 8px', background: '#fee2e2', color: '#991b1b' }}
                                  disabled={zhcActionLoading === req.id}
                                  onClick={() => zhcUpdateRequest(req.id, 'declined')}
                                >
                                  Decline
                                </button>
                              </div>
                            )}
                            {(req.status === 'accepted' || req.status === 'declined' || req.status === 'withdrawn') && (
                              <span style={{ fontSize: 11, color: '#9ca3af' }}>
                                {req.status === 'accepted' ? 'Profile updated — guaranteed hours applied' : 'No action required'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {activeTab === 'requests' && (
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
          </div>

          <input
            className="admin-input"
            placeholder="Search leave requests..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: 12, width: '100%', maxWidth: 320 }}
          />

          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
              <button
                className="admin-btn admin-btn-danger"
                onClick={bulkDeleteRequests}
                disabled={bulkDeleting}
                style={{ fontSize: 13 }}
              >
                {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
              </button>
              <button className="admin-btn" onClick={() => setSelectedIds(new Set())} style={{ fontSize: 13 }}>Clear Selection</button>
            </div>
          )}

          {loading ? <div className="admin-loading">Loading...</div> : (
            <div>
              {paginatedGroups.map(g => {
                const isExpanded = expandedEmployees.has(g.employeeId)
                const groupSelected = g.requests.every(r => selectedIds.has(r.id))
                const groupIndeterminate = !groupSelected && g.requests.some(r => selectedIds.has(r.id))
                return (
                  <div key={g.employeeId} style={{ border: '1px solid var(--border-color, #e0e0e0)', borderRadius: 8, marginBottom: 8, overflow: 'hidden', background: 'var(--card-bg, #fff)' }}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: isExpanded ? 'var(--hover-bg, #f5f7fa)' : 'transparent', transition: 'background 0.15s' }}
                      onClick={() => toggleExpandEmployee(g.employeeId)}
                    >
                      <input
                        type="checkbox"
                        checked={groupSelected}
                        ref={el => { if (el) el.indeterminate = groupIndeterminate }}
                        onChange={e => {
                          e.stopPropagation()
                          setSelectedIds(prev => {
                            const next = new Set(prev)
                            if (groupSelected) { g.requests.forEach(r => next.delete(r.id)) }
                            else { g.requests.forEach(r => next.add(r.id)) }
                            return next
                          })
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0, color: '#888' }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span className="admin-inline-avatar" style={{ gap: 8, fontWeight: 600, fontSize: 14 }}>
                        {g.avatar_url
                          ? <img src={g.avatar_url} alt="" />
                          : <span className="admin-avatar-initials">{g.name.split(' ').map(n => n[0]).join('')}</span>
                        }
                        {g.name}
                      </span>
                      <span className="admin-hide-mobile" style={{ fontSize: 12, color: '#64748b', marginLeft: 4 }}>
                        {g.managerId && managerNames[g.managerId] ? `Manager: ${managerNames[g.managerId]}` : ''}
                      </span>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: 12, color: '#666', background: 'var(--hover-bg, #f0f0f0)', padding: '2px 8px', borderRadius: 10 }}>
                          {g.requests.length} request{g.requests.length !== 1 ? 's' : ''}
                        </span>
                        {g.pendingCount > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, background: '#fff3e0', color: '#e65100', padding: '2px 7px', borderRadius: 10 }}>
                            {g.pendingCount} pending
                          </span>
                        )}
                        {g.approvedCount > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, background: '#e8f5e9', color: '#2e7d32', padding: '2px 7px', borderRadius: 10 }}>
                            {g.approvedCount} approved
                          </span>
                        )}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="admin-table-wrap" style={{ margin: 0, borderTop: '1px solid var(--border-color, #e0e0e0)' }}>
                        <table className="admin-table" style={{ marginBottom: 0 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 36 }}></th>
                              <th>Type</th>
                              <th>Dates</th>
                              <th>Days</th>
                              <th>Status</th>
                              <th>Reason</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.requests.map(r => (
                              <tr key={r.id}>
                                <td><input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                                <td>{r.leave_type?.name || '—'}</td>
                                <td>{editingId === r.id ? (
                                  <div className="admin-date-inputs">
                                    <input type="date" className="admin-inline-input" value={editForm.start_date} onChange={e => setEditForm(p => ({...p, start_date: e.target.value}))} />
                                    <input type="date" className="admin-inline-input" value={editForm.end_date} onChange={e => setEditForm(p => ({...p, end_date: e.target.value}))} />
                                  </div>
                                ) : `${new Date(r.start_date).toLocaleDateString('en-GB')} – ${new Date(r.end_date).toLocaleDateString('en-GB')}`}</td>
                                <td>{editingId === r.id ? <input type="number" step="0.5" className="admin-inline-input admin-inline-sm" value={editForm.days_requested} onChange={e => setEditForm(p => ({...p, days_requested: +e.target.value}))} /> : r.days_requested}</td>
                                <td>{editingId === r.id ? (
                                  <select className="admin-inline-select" value={editForm.status} onChange={e => setEditForm(p => ({...p, status: e.target.value}))}>
                                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                ) : (
                                  <span className={`admin-badge admin-badge-${r.status}`}>
                                    {r.status === 'approved' && <span style={{ color: '#43a047', fontWeight: 700, marginRight: 4 }}>✓</span>}
                                    {r.status === 'rejected' && <span style={{ color: '#e53935', fontWeight: 700, marginRight: 4 }}>✗</span>}
                                    {r.status}
                                  </span>
                                )}</td>
                                <td style={{ fontSize: 12, color: '#666', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason || '—'}</td>
                                <td className="admin-actions">
                                  {editingId === r.id ? (
                                    <>
                                      <button className="admin-btn-sm admin-btn-save" onClick={() => saveEdit(r.id)}>Save</button>
                                      <button className="admin-btn-sm admin-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
                                    </>
                                  ) : (
                                    <>
                                      {r.status === 'pending' && (
                                        <>
                                          <button className="admin-btn-icon" title="Approve" onClick={() => quickApproveDecline(r.id, 'approved')} style={{ color: '#43a047' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                                          </button>
                                          <button className="admin-btn-icon" title="Decline" onClick={() => quickApproveDecline(r.id, 'rejected')} style={{ color: '#e53935' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                          </button>
                                        </>
                                      )}
                                      <button className="admin-btn-icon" title="Edit" onClick={() => startEdit(r)}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                      </button>
                                      <button className="admin-btn-icon admin-btn-danger" title="Delete" onClick={() => deleteRequest(r.id)}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                      </button>
                                    </>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
              {filtered.length === 0 && <div className="admin-empty">No leave requests found</div>}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
                  <button className="admin-btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                  <span>Page {page} of {totalPages} ({grouped.length} employee{grouped.length !== 1 ? 's' : ''})</span>
                  <button className="admin-btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
