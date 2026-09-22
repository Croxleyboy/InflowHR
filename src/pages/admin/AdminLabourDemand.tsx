import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'

interface ShiftTemplate {
  id: string
  name: string
  colour: string
  start_time: string
  end_time: string
  department: string | null
  is_active: boolean
}

interface DemandRow {
  id?: string
  shift_template_id: string
  day_of_week: number
  min_staff: number
  max_staff: number
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function AdminLabourDemand() {
  const { selectedCompanyId } = useAdminCompany()
  const { showError, showSuccess } = useToast()
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [demand, setDemand] = useState<DemandRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [filterDept, setFilterDept] = useState('')

  useEffect(() => { if (selectedCompanyId) load() }, [selectedCompanyId])

  async function load() {
    setLoading(true)
    const [tmplRes, demandRes] = await Promise.all([
      supabase.from('shift_templates').select('id, name, colour, start_time, end_time, department, is_active')
        .eq('company_id', selectedCompanyId).eq('is_active', true).order('name'),
      supabase.from('labour_demand').select('id, shift_template_id, day_of_week, min_staff, max_staff')
        .eq('company_id', selectedCompanyId),
    ])
    setTemplates((tmplRes.data as ShiftTemplate[]) || [])
    setDemand((demandRes.data as DemandRow[]) || [])
    setLoading(false)
    setDirty(false)
  }

  const departments = useMemo(() => {
    const depts = new Set<string>()
    templates.forEach(t => { if (t.department) depts.add(t.department) })
    return Array.from(depts).sort()
  }, [templates])

  const filtered = useMemo(() => {
    if (!filterDept) return templates
    return templates.filter(t => t.department === filterDept)
  }, [templates, filterDept])

  function getDemand(templateId: string, day: number): { min: number; max: number } {
    const row = demand.find(d => d.shift_template_id === templateId && d.day_of_week === day)
    return row ? { min: row.min_staff, max: row.max_staff } : { min: 0, max: 0 }
  }

  function setDemandVal(templateId: string, day: number, field: 'min_staff' | 'max_staff', val: number) {
    setDirty(true)
    setDemand(prev => {
      const idx = prev.findIndex(d => d.shift_template_id === templateId && d.day_of_week === day)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], [field]: val }
        return updated
      }
      return [...prev, {
        shift_template_id: templateId,
        day_of_week: day,
        min_staff: field === 'min_staff' ? val : 0,
        max_staff: field === 'max_staff' ? val : 0,
      }]
    })
  }

  async function handleSave() {
    if (!selectedCompanyId) return
    setSaving(true)

    const nonZero = demand.filter(d => d.min_staff > 0 || d.max_staff > 0)

    for (const row of nonZero) {
      const payload = {
        company_id: selectedCompanyId,
        shift_template_id: row.shift_template_id,
        day_of_week: row.day_of_week,
        min_staff: row.min_staff,
        max_staff: Math.max(row.min_staff, row.max_staff),
      }
      if (row.id) {
        const { error } = await supabase.from('labour_demand').update({
          min_staff: payload.min_staff,
          max_staff: payload.max_staff,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id)
        if (error) { showError('Save failed: ' + error.message); setSaving(false); return }
      } else {
        const { error } = await supabase.from('labour_demand').upsert(payload, {
          onConflict: 'company_id,shift_template_id,day_of_week',
        })
        if (error) { showError('Save failed: ' + error.message); setSaving(false); return }
      }
    }

    const zeroed = demand.filter(d => d.min_staff === 0 && d.max_staff === 0 && d.id)
    for (const row of zeroed) {
      await supabase.from('labour_demand').delete().eq('id', row.id)
    }

    showSuccess('Labour demand saved')
    setSaving(false)
    load()
  }

  function getTemplateTotalDemand(templateId: string): number {
    return demand.filter(d => d.shift_template_id === templateId).reduce((sum, d) => sum + d.min_staff, 0)
  }

  if (loading) return <div className="admin-loading">Loading...</div>

  return (
    <>
      <div className="admin-mini-stats">
        <div className="admin-mini-stat">
          <span className="admin-mini-value">{filtered.length}</span>
          <span>Shift Templates</span>
        </div>
        <div className="admin-mini-stat">
          <span className="admin-mini-value" style={{ color: '#5c6bc0' }}>
            {demand.filter(d => d.min_staff > 0).length}
          </span>
          <span>Demand Rules</span>
        </div>
        <div className="admin-mini-stat">
          <span className="admin-mini-value" style={{ color: '#43a047' }}>
            {demand.reduce((s, d) => s + d.min_staff, 0)}
          </span>
          <span>Total Min Staff</span>
        </div>
      </div>

      <div className="admin-filters">
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="admin-select">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        {dirty && (
          <button className="admin-btn-sm admin-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-muted, #8b8fa3)', margin: '0 0 16px' }}>
        Set minimum and maximum staff required per shift template for each day of the week. These targets are shown in the rota scheduling grid.
      </p>

      {filtered.map(tmpl => (
        <div key={tmpl.id} className="ld-card">
          <div className="ld-card-header">
            <span className="ld-swatch" style={{ backgroundColor: tmpl.colour }} />
            <div className="ld-card-info">
              <span className="ld-card-name">{tmpl.name}</span>
              <span className="ld-card-meta">
                {tmpl.start_time.slice(0, 5)} – {tmpl.end_time.slice(0, 5)}
                {tmpl.department && <> &middot; {tmpl.department}</>}
              </span>
            </div>
            <span className="ld-card-total">
              {getTemplateTotalDemand(tmpl.id)} min/wk
            </span>
          </div>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}><div className="ld-grid">
            {DAY_LABELS.map((label, dayIdx) => {
              const d = getDemand(tmpl.id, dayIdx)
              return (
                <div key={dayIdx} className="ld-day">
                  <div className="ld-day-label">{label}</div>
                  <div className="ld-day-inputs">
                    <div className="ld-input-group">
                      <label>Min</label>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={d.min}
                        onChange={e => setDemandVal(tmpl.id, dayIdx, 'min_staff', Math.max(0, +e.target.value))}
                        className="ld-input"
                      />
                    </div>
                    <div className="ld-input-group">
                      <label>Max</label>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={d.max}
                        onChange={e => setDemandVal(tmpl.id, dayIdx, 'max_staff', Math.max(0, +e.target.value))}
                        className="ld-input"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div></div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="admin-empty">No active shift templates found. Create shift templates first.</div>
      )}
    </>
  )
}
