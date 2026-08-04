import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'

interface Rota {
  id: string
  company_id: string
  name: string
  start_date: string
  end_date: string
  department: string | null
  status: string
  allow_employee_edit: boolean
  created_at: string
}

interface ShiftAssignment {
  id: string
  company_id: string
  rota_id: string
  shift_template_id: string
  employee_id: string
  date: string
  notes: string | null
}

interface Employee {
  id: string
  first_name: string
  last_name: string
}

interface ShiftTemplate {
  id: string
  name: string
  colour: string
  start_time: string
  end_time: string
  break_minutes: number
}

interface LeaveConflict {
  employee_id: string
  start_date: string
  end_date: string
}

interface EmployeeAvailability {
  employee_id: string
  day_of_week: number
  start_time: string
  end_time: string
  is_available: boolean
}

interface RotaCounts {
  employee_count: number
  assignment_count: number
}

const EMPTY_ROTA = { name: '', start_date: '', end_date: '', department: '', status: 'draft', allow_employee_edit: false }

function getMonday(d: Date): Date {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
  dt.setDate(diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

function addDays(d: Date, n: number): Date {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function isDateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h + (m || 0) / 60
}

function calcShiftHours(template: ShiftTemplate): number {
  let hours = parseTime(template.end_time) - parseTime(template.start_time)
  if (hours < 0) hours += 24
  hours -= (template.break_minutes || 0) / 60
  return Math.max(0, hours)
}

function formatTimeShort(t: string): string {
  return t.substring(0, 5)
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function AdminRotas() {
  const { selectedCompanyId } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [rotas, setRotas] = useState<Rota[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_ROTA })
  const [editingRotaId, setEditingRotaId] = useState<string | null>(null)
  const [rotaCounts, setRotaCounts] = useState<Record<string, RotaCounts>>({})

  // Grid state
  const [selectedRota, setSelectedRota] = useState<Rota | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([])
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([])
  const [leaveConflicts, setLeaveConflicts] = useState<LeaveConflict[]>([])
  const [availability, setAvailability] = useState<EmployeeAvailability[]>([])
  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()))
  const [activeCell, setActiveCell] = useState<{ employeeId: string; date: string } | null>(null)
  const [editFormRota, setEditFormRota] = useState<Record<string, any>>({})

  useEffect(() => { if (selectedCompanyId) loadRotas() }, [selectedCompanyId])

  async function loadRotas() {
    setLoading(true)
    const { data } = await supabase
      .from('rotas')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false })
    const rotaList = (data as Rota[]) || []
    setRotas(rotaList)
    setLoading(false)
    // Load counts for each rota
    if (rotaList.length > 0) {
      const rotaIds = rotaList.map(r => r.id)
      const { data: assignData } = await supabase
        .from('shift_assignments')
        .select('rota_id, employee_id')
        .in('rota_id', rotaIds)
      const counts: Record<string, RotaCounts> = {}
      rotaIds.forEach(id => { counts[id] = { employee_count: 0, assignment_count: 0 } })
      if (assignData) {
        const empSets: Record<string, Set<string>> = {}
        rotaIds.forEach(id => { empSets[id] = new Set() })
        assignData.forEach((a: any) => {
          counts[a.rota_id].assignment_count++
          empSets[a.rota_id].add(a.employee_id)
        })
        rotaIds.forEach(id => { counts[id].employee_count = empSets[id].size })
      }
      setRotaCounts(counts)
    }
  }

  async function createRota() {
    if (!addForm.name.trim() || !addForm.start_date || !addForm.end_date) return
    const { error } = await supabase.from('rotas').insert({
      company_id: selectedCompanyId,
      name: addForm.name.trim(),
      start_date: addForm.start_date,
      end_date: addForm.end_date,
      department: addForm.department || null,
      status: addForm.status,
      allow_employee_edit: addForm.allow_employee_edit,
    })
    if (error) { showError('Failed to create rota: ' + error.message); return }
    showSuccess('Rota created')
    setAddForm({ ...EMPTY_ROTA })
    setShowModal(false)
    loadRotas()
  }

  function startEditRota(r: Rota) {
    setEditingRotaId(r.id)
    setEditFormRota({
      name: r.name,
      start_date: r.start_date,
      end_date: r.end_date,
      department: r.department || '',
      status: r.status,
      allow_employee_edit: r.allow_employee_edit ?? false,
    })
    setShowModal(true)
  }

  async function saveEditRota(id: string) {
    const { error } = await supabase.from('rotas').update({
      name: editFormRota.name,
      start_date: editFormRota.start_date,
      end_date: editFormRota.end_date,
      department: editFormRota.department || null,
      status: editFormRota.status,
      allow_employee_edit: editFormRota.allow_employee_edit ?? false,
    }).eq('id', id)
    if (error) { showError('Failed to update rota: ' + error.message); return }
    setEditingRotaId(null)
    setShowModal(false)
    loadRotas()
  }

  async function deleteRota(id: string) {
    if (!confirm('Delete this rota and all its assignments?')) return
    const { error: delAssign } = await supabase.from('shift_assignments').delete().eq('rota_id', id)
    if (delAssign) { showError('Failed to delete assignments: ' + delAssign.message); return }
    const { error: delRota } = await supabase.from('rotas').delete().eq('id', id)
    if (delRota) { showError('Failed to delete rota: ' + delRota.message); return }
    setRotas(prev => prev.filter(r => r.id !== id))
  }

  async function publishRota(id: string) {
    if (!confirm('Publish this rota? Employees will be notified.')) return
    const { error } = await supabase.from('rotas').update({ status: 'published' }).eq('id', id)
    if (error) { showError('Failed to publish rota: ' + error.message); return }
    loadRotas()
    if (selectedRota && selectedRota.id === id) {
      setSelectedRota(prev => prev ? { ...prev, status: 'published' } : null)
    }
  }

  async function toggleAllowEdit(r: Rota) {
    const newVal = !r.allow_employee_edit
    const { error } = await supabase.from('rotas').update({ allow_employee_edit: newVal }).eq('id', r.id)
    if (error) { showError('Failed to update rota: ' + error.message); return }
    setRotas(prev => prev.map(x => x.id === r.id ? { ...x, allow_employee_edit: newVal } : x))
    if (selectedRota && selectedRota.id === r.id) {
      setSelectedRota(prev => prev ? { ...prev, allow_employee_edit: newVal } : null)
    }
  }

  // --- Grid data loading ---
  const loadGridData = useCallback(async (rota: Rota) => {
    const [empRes, tmplRes, assignRes, leaveRes, availRes] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name').eq('company_id', selectedCompanyId).eq('is_active', true).order('first_name'),
      supabase.from('shift_templates').select('id, name, colour, start_time, end_time, break_minutes').eq('company_id', selectedCompanyId).eq('is_active', true),
      supabase.from('shift_assignments').select('*').eq('rota_id', rota.id),
      supabase.from('leave_requests').select('employee_id, start_date, end_date').eq('company_id', selectedCompanyId).in('status', ['pending', 'approved']),
      supabase.from('employee_availability').select('employee_id, day_of_week, start_time, end_time, is_available').eq('company_id', selectedCompanyId),
    ])
    setEmployees((empRes.data as Employee[]) || [])
    setShiftTemplates((tmplRes.data as ShiftTemplate[]) || [])
    setAssignments((assignRes.data as ShiftAssignment[]) || [])
    setLeaveConflicts((leaveRes.data as LeaveConflict[]) || [])
    setAvailability((availRes.data as EmployeeAvailability[]) || [])
  }, [selectedCompanyId])

  function openRota(rota: Rota) {
    setSelectedRota(rota)
    setWeekStart(getMonday(new Date(rota.start_date)))
    loadGridData(rota)
  }

  function backToList() {
    setSelectedRota(null)
    setActiveCell(null)
    loadRotas()
  }

  // Week days for the grid
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i)
      return { date: formatDate(d), label: DAY_LABELS[i], dayNum: d.getDate(), month: d.toLocaleDateString('en-GB', { month: 'short' }), dayOfWeek: d.getDay() }
    })
  }, [weekStart])

  // Check if employee has leave on date
  function hasLeave(employeeId: string, date: string): boolean {
    return leaveConflicts.some(l => l.employee_id === employeeId && isDateInRange(date, l.start_date, l.end_date))
  }

  // Get availability for employee on a given day of week
  function getAvailability(employeeId: string, dayOfWeek: number): 'available' | 'unavailable' | 'unset' {
    const rec = availability.find(a => a.employee_id === employeeId && a.day_of_week === dayOfWeek)
    if (!rec) return 'unset'
    return rec.is_available ? 'available' : 'unavailable'
  }

  // Get assignment for employee + date
  function getAssignment(employeeId: string, date: string): ShiftAssignment | undefined {
    return assignments.find(a => a.employee_id === employeeId && a.date === date)
  }

  // Get shift template by id
  function getTemplate(id: string): ShiftTemplate | undefined {
    return shiftTemplates.find(t => t.id === id)
  }

  function isDateInRotaRange(date: string): boolean {
    if (!selectedRota) return false
    return date >= selectedRota.start_date && date <= selectedRota.end_date
  }

  async function assignShift(employeeId: string, date: string, templateId: string) {
    if (!isDateInRotaRange(date)) {
      alert(`Cannot assign shifts outside rota dates (${selectedRota!.start_date} to ${selectedRota!.end_date})`)
      setActiveCell(null)
      return
    }

    const existing = getAssignment(employeeId, date)

    if (!existing) {
      const { data: otherRotaShifts } = await supabase
        .from('shift_assignments')
        .select('id, rota_id, rotas:rotas(name)')
        .eq('employee_id', employeeId)
        .eq('date', date)
        .eq('company_id', selectedCompanyId)
        .neq('rota_id', selectedRota!.id)
        .limit(1)
      if (otherRotaShifts && otherRotaShifts.length > 0) {
        const joined = otherRotaShifts[0] as { rotas?: { name: string }[] }
        const otherName = joined.rotas?.[0]?.name || 'another rota'
        if (!window.confirm(`This employee already has a shift on ${date} in "${otherName}". Assign anyway?`)) {
          setActiveCell(null)
          return
        }
      }
    }

    if (existing) {
      const { error } = await supabase.from('shift_assignments').update({ shift_template_id: templateId }).eq('id', existing.id)
      if (error) { showError('Failed to update shift: ' + error.message); return }
    } else {
      const { error } = await supabase.from('shift_assignments').insert({
        company_id: selectedCompanyId,
        rota_id: selectedRota!.id,
        shift_template_id: templateId,
        employee_id: employeeId,
        date,
      })
      if (error) { showError('Failed to assign shift: ' + error.message); return }
    }
    setActiveCell(null)
    const { data, error: fetchErr } = await supabase.from('shift_assignments').select('*').eq('rota_id', selectedRota!.id)
    if (fetchErr) console.error('[AdminRotas] refresh error:', fetchErr)
    console.log('[AdminRotas] assignments after save:', data?.length, 'dates:', data?.map((a: any) => a.date))
    setAssignments((data as ShiftAssignment[]) || [])
  }

  async function removeAssignment(employeeId: string, date: string) {
    const existing = getAssignment(employeeId, date)
    if (!existing) return
    const { error } = await supabase.from('shift_assignments').delete().eq('id', existing.id)
    if (error) { showError('Failed to remove shift: ' + error.message); return }
    setAssignments(prev => prev.filter(a => a.id !== existing.id))
    setActiveCell(null)
  }

  const stats = useMemo(() => ({
    total: rotas.length,
    draft: rotas.filter(r => r.status === 'draft').length,
    published: rotas.filter(r => r.status === 'published').length,
  }), [rotas])

  // Grid summary stats
  const gridStats = useMemo(() => {
    if (!selectedRota) return { totalHours: 0, employeeCount: 0, coverage: 0, unassigned: 0 }
    // Only count assignments in the current week
    const weekDates = Array.from({ length: 7 }, (_, i) => formatDate(addDays(weekStart, i)))
    const weekAssignments = assignments.filter(a => weekDates.includes(a.date))
    let totalHours = 0
    const employeesWithShifts = new Set<string>()
    weekAssignments.forEach(a => {
      const tmpl = getTemplate(a.shift_template_id)
      if (tmpl) totalHours += calcShiftHours(tmpl)
      employeesWithShifts.add(a.employee_id)
    })
    const totalSlots = employees.length * 7
    const filledSlots = weekAssignments.length
    const coverage = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0
    return {
      totalHours: Math.round(totalHours * 10) / 10,
      employeeCount: employeesWithShifts.size,
      coverage,
      unassigned: totalSlots - filledSlots,
    }
  }, [assignments, employees, shiftTemplates, weekStart, selectedRota])

  // Format week range label
  const weekRangeLabel = useMemo(() => {
    const start = weekDays[0]
    const end = weekDays[6]
    return `${start.label} ${start.dayNum} ${start.month} – ${end.label} ${end.dayNum} ${end.month}`
  }, [weekDays])

  const dayColumnHours = useMemo(() => {
    return weekDays.map(d => {
      let h = 0
      assignments.filter(a => a.date === d.date).forEach(a => {
        const tmpl = getTemplate(a.shift_template_id)
        if (tmpl) h += calcShiftHours(tmpl)
      })
      return Math.round(h * 10) / 10
    })
  }, [assignments, weekDays, shiftTemplates])

  const dayColumnCount = useMemo(() => {
    return weekDays.map(d => assignments.filter(a => a.date === d.date).length)
  }, [assignments, weekDays])

  const todayStr = formatDate(new Date())

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!activeCell) return
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.rota-cell-dropdown') && !target.closest('.rg-shift') && !target.closest('.rg-plus') && !target.closest('.rg-empty')) {
        setActiveCell(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [activeCell])

  // --- MODAL for create / edit ---
  function renderModal() {
    if (!showModal) return null
    const isEdit = !!editingRotaId
    const form = isEdit ? editFormRota : addForm
    const setForm = isEdit
      ? (fn: (prev: any) => any) => setEditFormRota(fn)
      : (fn: (prev: any) => any) => setAddForm(fn)
    return (
      <div className="rota-modal-overlay" onClick={() => { setShowModal(false); setEditingRotaId(null) }}>
        <div className="rota-modal" onClick={e => e.stopPropagation()}>
          <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>{isEdit ? 'Edit Rota' : 'Create New Rota'}</h3>
          <div className="rota-modal-field">
            <label>Name</label>
            <input value={form.name} onChange={e => setForm((p: any) => ({ ...p, name: e.target.value }))} placeholder="e.g. Week 31 Rota" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="rota-modal-field">
              <label>Start Date</label>
              <input type="date" value={form.start_date} onChange={e => setForm((p: any) => ({ ...p, start_date: e.target.value }))} />
            </div>
            <div className="rota-modal-field">
              <label>End Date</label>
              <input type="date" value={form.end_date} onChange={e => setForm((p: any) => ({ ...p, end_date: e.target.value }))} />
            </div>
          </div>
          <div className="rota-modal-field">
            <label>Department</label>
            <input value={form.department} onChange={e => setForm((p: any) => ({ ...p, department: e.target.value }))} placeholder="Optional" />
          </div>
          <div className="rota-modal-field">
            <label>Status</label>
            <select value={form.status} onChange={e => setForm((p: any) => ({ ...p, status: e.target.value }))}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
          <div className="rota-modal-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.allow_employee_edit ?? false} onChange={e => setForm((p: any) => ({ ...p, allow_employee_edit: e.target.checked }))} />
              Allow employee self-editing
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
            <button className="admin-btn-sm admin-btn-cancel" onClick={() => { setShowModal(false); setEditingRotaId(null) }}>Cancel</button>
            <button className="admin-btn-sm admin-btn-save" onClick={() => isEdit ? saveEditRota(editingRotaId!) : createRota()}>
              {isEdit ? 'Save Changes' : 'Create Rota'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- ROTA LIST VIEW ---
  if (!selectedRota) {
    return (
      <>
        <div className="admin-mini-stats">
          <div className="admin-mini-stat" style={{ borderLeft: '4px solid #5c6bc0' }}>
            <span className="admin-mini-value">{stats.total}</span><span>Total Rotas</span>
          </div>
          <div className="admin-mini-stat" style={{ borderLeft: '4px solid #ff9800' }}>
            <span className="admin-mini-value" style={{ color: '#ff9800' }}>{stats.draft}</span><span>Draft</span>
          </div>
          <div className="admin-mini-stat" style={{ borderLeft: '4px solid #43a047' }}>
            <span className="admin-mini-value" style={{ color: '#43a047' }}>{stats.published}</span><span>Published</span>
          </div>
        </div>

        <div className="admin-filters">
          <button className="admin-btn-sm admin-btn-save" onClick={() => { setEditingRotaId(null); setAddForm({ ...EMPTY_ROTA }); setShowModal(true) }}>
            + Create Rota
          </button>
        </div>

        {renderModal()}

        {/* Timeline Chart */}
        {rotas.length > 0 && (() => {
          const allDates = rotas.flatMap(r => [r.start_date, r.end_date])
          const minDate = new Date(allDates.reduce((a, b) => a < b ? a : b) + 'T00:00:00')
          const maxDate = new Date(allDates.reduce((a, b) => a > b ? a : b) + 'T00:00:00')
          const pad = 7
          const chartStart = addDays(minDate, -pad)
          const chartEnd = addDays(maxDate, pad)
          const totalDays = Math.max(1, Math.round((chartEnd.getTime() - chartStart.getTime()) / 86400000))
          const todayOffset = Math.round((new Date().getTime() - chartStart.getTime()) / 86400000)
          const todayPct = Math.max(0, Math.min(100, (todayOffset / totalDays) * 100))

          const monthMarkers: { label: string; pct: number }[] = []
          const cursor = new Date(chartStart)
          cursor.setDate(1)
          if (cursor < chartStart) cursor.setMonth(cursor.getMonth() + 1)
          while (cursor <= chartEnd) {
            const offset = Math.round((cursor.getTime() - chartStart.getTime()) / 86400000)
            monthMarkers.push({ label: cursor.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), pct: (offset / totalDays) * 100 })
            cursor.setMonth(cursor.getMonth() + 1)
          }

          const COLORS = ['#5c6bc0', '#26a69a', '#ef5350', '#ffa726', '#66bb6a', '#ab47bc', '#42a5f5', '#ec407a']

          return (
            <div className="rt-timeline">
              <div className="rt-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>Rota Timeline</span>
              </div>
              <div className="rt-chart">
                {/* Month markers */}
                <div className="rt-months">
                  {monthMarkers.map((m, i) => (
                    <div key={i} className="rt-month" style={{ left: `${m.pct}%` }}>
                      <div className="rt-month-line" />
                      <span>{m.label}</span>
                    </div>
                  ))}
                </div>
                {/* Today marker */}
                {todayPct > 0 && todayPct < 100 && (
                  <div className="rt-today-line" style={{ left: `${todayPct}%` }}>
                    <span>Today</span>
                  </div>
                )}
                {/* Rota bars */}
                <div className="rt-bars">
                  {rotas.map((r, idx) => {
                    const startOff = Math.round((new Date(r.start_date + 'T00:00:00').getTime() - chartStart.getTime()) / 86400000)
                    const endOff = Math.round((new Date(r.end_date + 'T00:00:00').getTime() - chartStart.getTime()) / 86400000)
                    const leftPct = (startOff / totalDays) * 100
                    const widthPct = Math.max(0.5, ((endOff - startOff + 1) / totalDays) * 100)
                    const colour = COLORS[idx % COLORS.length]
                    const isPublished = r.status === 'published'
                    return (
                      <div key={r.id} className="rt-row">
                        <div className="rt-row-label">{r.name}</div>
                        <div className="rt-row-track">
                          <div
                            className={`rt-bar ${isPublished ? '' : 'rt-bar-draft'}`}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: colour }}
                            title={`${r.name}: ${new Date(r.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(r.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                            onClick={() => openRota(r)}
                          >
                            <span className="rt-bar-label">
                              {new Date(r.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {new Date(r.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}

        {loading ? <div className="admin-loading">Loading...</div> : (
          <div className="rc-list">
            {rotas.map(r => {
              const isPublished = r.status === 'published'
              const counts = rotaCounts[r.id] || { employee_count: 0, assignment_count: 0 }
              return (
                <div key={r.id} className="rc-card" onClick={() => openRota(r)}>
                  <div className={`rc-indicator ${isPublished ? 'rc-ind-green' : 'rc-ind-orange'}`} />
                  <div className="rc-body">
                    <div className="rc-row1">
                      <div className="rc-name">{r.name}</div>
                      <div className="rc-badges">
                        {r.department && <span className="rg-badge rg-badge-blue">{r.department}</span>}
                        <span className={`rg-badge ${isPublished ? 'rg-badge-green' : 'rg-badge-orange'}`}>
                          {isPublished ? 'Published' : 'Draft'}
                        </span>
                      </div>
                    </div>
                    <div className="rc-row2">
                      <span className="rc-dates">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        {new Date(r.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {new Date(r.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <span className="rc-metric">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                        {counts.employee_count}
                      </span>
                      <span className="rc-metric">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                        {counts.assignment_count} shifts
                      </span>
                    </div>
                    <div className="rc-row3">
                      <label className="rc-toggle" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={r.allow_employee_edit ?? false} onChange={() => toggleAllowEdit(r)} />
                        Self-edit
                      </label>
                      <div className="rc-actions" onClick={e => e.stopPropagation()}>
                        <button className="rc-btn rc-btn-primary" onClick={() => openRota(r)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                          Grid
                        </button>
                        <button className="rc-btn" onClick={() => startEditRota(r)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          Edit
                        </button>
                        {!isPublished && (
                          <button className="rc-btn rc-btn-publish" onClick={() => publishRota(r.id)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                            Publish
                          </button>
                        )}
                        <button className="rc-btn rc-btn-danger" onClick={() => deleteRota(r.id)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {rotas.length === 0 && <div className="admin-empty">No rotas found. Create one to get started.</div>}
          </div>
        )}
      </>
    )
  }

  function empWeekHours(empId: string): number {
    let h = 0
    for (const a of assignments) {
      if (a.employee_id !== empId) continue
      const wd = weekDays.map(d => d.date)
      if (!wd.includes(a.date)) continue
      const tmpl = getTemplate(a.shift_template_id)
      if (tmpl) h += calcShiftHours(tmpl)
    }
    return Math.round(h * 10) / 10
  }

  // --- ROTA GRID VIEW ---
  return (
    <>
      {renderModal()}

      {/* Top Bar */}
      <div className="rg-topbar">
        <button className="rg-back" onClick={backToList}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div className="rg-topbar-info">
          <h2 className="rg-title">{selectedRota.name}</h2>
          <div className="rg-topbar-meta">
            <span className={`rg-badge ${selectedRota.status === 'published' ? 'rg-badge-green' : 'rg-badge-orange'}`}>
              {selectedRota.status === 'published' ? 'Published' : 'Draft'}
            </span>
            {selectedRota.department && <span className="rg-badge rg-badge-blue">{selectedRota.department}</span>}
            <span className={`rg-badge ${selectedRota.allow_employee_edit ? 'rg-badge-green' : 'rg-badge-grey'}`}>
              Self-edit: {selectedRota.allow_employee_edit ? 'ON' : 'OFF'}
            </span>
            <label className="rg-toggle-label">
              <input type="checkbox" checked={selectedRota.allow_employee_edit ?? false} onChange={() => toggleAllowEdit(selectedRota)} />
            </label>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="rg-stats-row">
        <div className="rg-stat-card rg-stat-blue">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <div>
            <div className="rg-stat-val">{gridStats.totalHours}h</div>
            <div className="rg-stat-lbl">Scheduled</div>
          </div>
        </div>
        <div className="rg-stat-card rg-stat-purple">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div>
            <div className="rg-stat-val">{gridStats.employeeCount}/{employees.length}</div>
            <div className="rg-stat-lbl">Staffed</div>
          </div>
        </div>
        <div className="rg-stat-card rg-stat-green">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <div>
            <div className="rg-stat-val">{gridStats.coverage}%</div>
            <div className="rg-stat-lbl">Coverage</div>
          </div>
        </div>
        <div className="rg-stat-card rg-stat-orange">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <div>
            <div className="rg-stat-val">{gridStats.unassigned}</div>
            <div className="rg-stat-lbl">Open slots</div>
          </div>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="rg-week-nav">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="rg-week-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>{weekRangeLabel}</span>
        </div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button className="rg-today-btn" onClick={() => setWeekStart(getMonday(new Date()))}>Today</button>
      </div>

      {/* Grid */}
      <div className="rg-grid-wrap">
        <table className="rg-table">
          <thead>
            <tr>
              <th className="rg-th-emp">Employee</th>
              {weekDays.map((d, i) => {
                const isToday = d.date === todayStr
                const inRange = isDateInRotaRange(d.date)
                return (
                  <th key={d.date} className={`rg-th-day ${isToday ? 'rg-th-today' : ''} ${!inRange ? 'rg-th-out' : ''}`}>
                    <div className="rg-th-day-name">{d.label}</div>
                    <div className={`rg-th-day-num ${isToday ? 'rg-th-today-num' : ''}`}>{d.dayNum}</div>
                    {inRange
                      ? <div className="rg-th-day-count">{dayColumnCount[i]} shifts &middot; {dayColumnHours[i]}h</div>
                      : <div className="rg-th-day-count" style={{ color: '#ccc' }}>out of range</div>
                    }
                  </th>
                )
              })}
              <th className="rg-th-total">Hours</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => {
              const initials = `${emp.first_name.charAt(0)}${emp.last_name.charAt(0)}`.toUpperCase()
              const wh = empWeekHours(emp.id)
              return (
                <tr key={emp.id}>
                  <td className="rg-td-emp">
                    <div className="rg-emp-row">
                      <div className="rg-emp-avatar">{initials}</div>
                      <div>
                        <div className="rg-emp-name">{emp.first_name} {emp.last_name}</div>
                        <div className="rg-emp-avail">
                          {weekDays.map(d => {
                            const avail = getAvailability(emp.id, d.dayOfWeek)
                            return <span key={d.date} className={`rg-dot rg-dot-${avail === 'available' ? 'on' : avail === 'unavailable' ? 'off' : 'na'}`} title={`${d.label}: ${avail}`} />
                          })}
                        </div>
                      </div>
                    </div>
                  </td>
                  {weekDays.map(d => {
                    const inRange = isDateInRotaRange(d.date)
                    const assignment = getAssignment(emp.id, d.date)
                    const template = assignment ? getTemplate(assignment.shift_template_id) : undefined
                    const onLeave = hasLeave(emp.id, d.date)
                    const isActive = activeCell?.employeeId === emp.id && activeCell?.date === d.date
                    const isToday = d.date === todayStr

                    if (!inRange) {
                      return (
                        <td key={d.date} className="rg-td-cell rg-td-out">
                          <div className="rg-out-cell" />
                        </td>
                      )
                    }

                    return (
                      <td key={d.date} className={`rg-td-cell ${isToday ? 'rg-td-today' : ''}`}>
                        {assignment && template ? (
                          <div
                            className="rg-shift"
                            style={{ borderLeftColor: template.colour, background: `${template.colour}1A` }}
                            onClick={() => setActiveCell(isActive ? null : { employeeId: emp.id, date: d.date })}
                          >
                            {onLeave && <div className="rg-shift-leave-tag">On Leave</div>}
                            <div className="rg-shift-name" style={{ color: template.colour }}>{template.name}</div>
                            <div className="rg-shift-time">{formatTimeShort(template.start_time)}{'–'}{formatTimeShort(template.end_time)}</div>
                            <div className="rg-shift-hrs">{calcShiftHours(template).toFixed(1)}h</div>
                          </div>
                        ) : (
                          <div
                            className={`rg-empty ${onLeave ? 'rg-empty-leave' : ''}`}
                            onClick={() => setActiveCell(isActive ? null : { employeeId: emp.id, date: d.date })}
                          >
                            {onLeave ? <span className="rg-leave-pill">Leave</span> : <span className="rg-plus">+</span>}
                          </div>
                        )}

                        {isActive && (
                          <div className="rota-cell-dropdown">
                            <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 }}>Assign Shift</div>
                            {shiftTemplates.map(t => (
                              <button key={t.id} onClick={() => assignShift(emp.id, d.date, t.id)}>
                                <span className="rg-dd-swatch" style={{ backgroundColor: t.colour }} />
                                <span style={{ flex: 1 }}>{t.name}</span>
                                <span style={{ fontSize: 11, color: '#aaa' }}>{formatTimeShort(t.start_time)}{'–'}{formatTimeShort(t.end_time)}</span>
                              </button>
                            ))}
                            {assignment && (
                              <button onClick={() => removeAssignment(emp.id, d.date)} style={{ color: '#e53935', borderTop: '1px solid #f0f0f0' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                Remove
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  <td className="rg-td-total">{wh}h</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {employees.length === 0 && <div className="admin-empty" style={{ padding: 40 }}>No active employees found</div>}
      </div>

      {selectedRota.status === 'draft' && (
        <div className="rg-publish-bar">
          <div className="rg-publish-info">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e65100" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>This rota is in draft. Publish to notify employees.</span>
          </div>
          <button onClick={() => publishRota(selectedRota.id)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            Publish Rota
          </button>
        </div>
      )}
    </>
  )
}
