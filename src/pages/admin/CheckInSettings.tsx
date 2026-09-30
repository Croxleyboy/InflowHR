import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAdminCompany } from '../../context/AdminCompanyContext'
import { useToast } from '../../context/ToastContext'
import type { CheckinSettings } from '../../context/CheckInContext'

interface WorkLocationRow {
  id: string
  name: string
  address: string
  latitude: number
  longitude: number
  radius_metres: number
  allow_remote: boolean
  is_active: boolean
}

interface Props {
  source: 'timesheets' | 'shifts'
}

export default function CheckInSettingsPanel({ source }: Props) {
  const { selectedCompanyId } = useAdminCompany()
  const companyId = selectedCompanyId || ''
  const { showSuccess, showError } = useToast()

  const [settings, setSettings] = useState<CheckinSettings | null>(null)
  const [locations, setLocations] = useState<WorkLocationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [departments, setDepartments] = useState<string[]>([])

  const [showLocForm, setShowLocForm] = useState(false)
  const [editingLoc, setEditingLoc] = useState<WorkLocationRow | null>(null)
  const [locForm, setLocForm] = useState({ name: '', address: '', latitude: '', longitude: '', radius_metres: '200', allow_remote: false })

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [sRes, lRes, dRes] = await Promise.all([
      supabase.from('checkin_settings').select('*').eq('company_id', companyId).single(),
      supabase.from('work_locations').select('*').eq('company_id', companyId).order('name'),
      supabase.from('employees').select('department').eq('company_id', companyId).eq('is_active', true),
    ])
    if (sRes.data) setSettings(sRes.data)
    else {
      const { data: newS } = await supabase.from('checkin_settings').insert({ company_id: companyId }).select().single()
      if (newS) setSettings(newS)
    }
    if (lRes.data) setLocations(lRes.data)
    if (dRes.data) {
      const unique = [...new Set(dRes.data.map((d: { department: string | null }) => d.department).filter(Boolean))] as string[]
      setDepartments(unique.sort())
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => { load() }, [load])

  const enabledKey = source === 'timesheets' ? 'timesheets_checkin_enabled' : 'shifts_checkin_enabled'

  async function toggleEnabled() {
    if (!settings) return
    const newVal = !settings[enabledKey]
    setSaving(true)

    if (!newVal) {
      const { data: count } = await supabase.rpc('cancel_current_month_checkins', {
        p_company_id: companyId,
        p_source: source,
      })
      if (typeof count === 'number' && count > 0) {
        showSuccess(`Check-in disabled. ${count} current-month record${count > 1 ? 's' : ''} cancelled.`)
      }
    }

    const { error } = await supabase.from('checkin_settings').update({
      [enabledKey]: newVal,
      updated_at: new Date().toISOString(),
    }).eq('id', settings.id)

    if (error) { showError(error.message); setSaving(false); return }
    setSettings({ ...settings, [enabledKey]: newVal })
    if (newVal) showSuccess('Check-in enabled')
    setSaving(false)
  }

  async function updateSetting(key: string, value: unknown) {
    if (!settings) return
    const { error } = await supabase.from('checkin_settings').update({
      [key]: value,
      updated_at: new Date().toISOString(),
    }).eq('id', settings.id)
    if (error) { showError(error.message); return }
    setSettings({ ...settings, [key]: value } as CheckinSettings)
    showSuccess('Setting updated')
  }

  function openLocForm(loc?: WorkLocationRow) {
    if (loc) {
      setEditingLoc(loc)
      setLocForm({
        name: loc.name, address: loc.address || '', latitude: String(loc.latitude),
        longitude: String(loc.longitude), radius_metres: String(loc.radius_metres),
        allow_remote: loc.allow_remote,
      })
    } else {
      setEditingLoc(null)
      setLocForm({ name: '', address: '', latitude: '', longitude: '', radius_metres: '200', allow_remote: false })
    }
    setShowLocForm(true)
  }

  async function saveLoc() {
    const lat = parseFloat(locForm.latitude)
    const lng = parseFloat(locForm.longitude)
    const radius = parseInt(locForm.radius_metres, 10)
    if (!locForm.name.trim()) { showError('Name is required'); return }
    if (isNaN(lat) || lat < -90 || lat > 90) { showError('Invalid latitude (-90 to 90)'); return }
    if (isNaN(lng) || lng < -180 || lng > 180) { showError('Invalid longitude (-180 to 180)'); return }
    if (isNaN(radius) || radius < 50) { showError('Radius must be at least 50 metres'); return }

    setSaving(true)
    const row = {
      company_id: companyId,
      name: locForm.name.trim(),
      address: locForm.address.trim(),
      latitude: lat,
      longitude: lng,
      radius_metres: radius,
      allow_remote: locForm.allow_remote,
    }

    if (editingLoc) {
      const { error } = await supabase.from('work_locations').update({ ...row, updated_at: new Date().toISOString() }).eq('id', editingLoc.id)
      if (error) { showError(error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('work_locations').insert(row)
      if (error) { showError(error.message); setSaving(false); return }
    }
    showSuccess(editingLoc ? 'Location updated' : 'Location added')
    setShowLocForm(false)
    setSaving(false)
    load()
  }

  async function deleteLoc(id: string) {
    if (!confirm('Delete this work location?')) return
    const { error } = await supabase.from('work_locations').delete().eq('id', id)
    if (error) { showError(error.message); return }
    showSuccess('Location deleted')
    load()
  }

  async function toggleLocActive(loc: WorkLocationRow) {
    const { error } = await supabase.from('work_locations').update({ is_active: !loc.is_active, updated_at: new Date().toISOString() }).eq('id', loc.id)
    if (error) { showError(error.message); return }
    load()
  }

  if (loading) return <div className="admin-loading">Loading...</div>

  return (
    <div>
      {/* Enable/Disable toggle */}
      <div className="admin-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              {source === 'timesheets' ? 'Timesheets' : 'Shifts'} Check-In
            </h3>
            <p style={{ fontSize: 13, color: '#888', margin: '4px 0 0' }}>
              {settings?.[enabledKey]
                ? 'Employees can check in using geolocation'
                : 'Check-in is currently disabled'}
            </p>
          </div>
          <label className="admin-toggle" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings?.[enabledKey] || false}
              onChange={toggleEnabled}
              disabled={saving}
            />
            <span className="admin-toggle-slider" />
          </label>
        </div>

        {settings?.[enabledKey] && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#888', display: 'block', marginBottom: 4 }}>Allow Work From Home</label>
                <label className="admin-toggle" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={settings.allow_work_from_home} onChange={() => updateSetting('allow_work_from_home', !settings.allow_work_from_home)} />
                  <span className="admin-toggle-slider" />
                </label>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#888', display: 'block', marginBottom: 4 }}>Auto-Checkout (hours)</label>
                <input className="admin-input" type="number" min={1} max={24} value={settings.auto_checkout_hours}
                  onChange={e => updateSetting('auto_checkout_hours', parseInt(e.target.value, 10) || 2)}
                  style={{ maxWidth: 100 }} />
              </div>
              {source === 'shifts' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#888', display: 'block', marginBottom: 4 }}>Prompt Before Shift (mins)</label>
                  <input className="admin-input" type="number" min={5} max={60} value={settings.prompt_before_shift_mins}
                    onChange={e => updateSetting('prompt_before_shift_mins', parseInt(e.target.value, 10) || 20)}
                    style={{ maxWidth: 100 }} />
                </div>
              )}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#888', display: 'block', marginBottom: 4 }}>Enabled Departments</label>
                <select className="admin-input" value={settings.allowed_departments ? 'specific' : 'all'}
                  onChange={e => updateSetting('allowed_departments', e.target.value === 'all' ? null : [])}>
                  <option value="all">All Departments</option>
                  <option value="specific">Specific Departments</option>
                </select>
                {settings.allowed_departments !== null && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {departments.map(d => (
                      <label key={d} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input type="checkbox" checked={settings.allowed_departments?.includes(d) || false}
                          onChange={() => {
                            const current = settings.allowed_departments || []
                            const next = current.includes(d) ? current.filter(x => x !== d) : [...current, d]
                            updateSetting('allowed_departments', next)
                          }} />
                        {d}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Work Locations */}
      <div className="admin-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Work Locations</h3>
          <button className="admin-save-btn" onClick={() => openLocForm()}>+ Add Location</button>
        </div>

        {showLocForm && (
          <div style={{ background: 'var(--bg, #f9f9f9)', border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Name *</label>
                <input className="admin-input" value={locForm.name} onChange={e => setLocForm({ ...locForm, name: e.target.value })} placeholder="Head Office" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Address</label>
                <input className="admin-input" value={locForm.address} onChange={e => setLocForm({ ...locForm, address: e.target.value })} placeholder="123 High Street" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Latitude *</label>
                <input className="admin-input" type="number" step="any" value={locForm.latitude} onChange={e => setLocForm({ ...locForm, latitude: e.target.value })} placeholder="51.5074" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Longitude *</label>
                <input className="admin-input" type="number" step="any" value={locForm.longitude} onChange={e => setLocForm({ ...locForm, longitude: e.target.value })} placeholder="-0.1278" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block' }}>Radius (metres, min 50)</label>
                <input className="admin-input" type="number" min={50} value={locForm.radius_metres} onChange={e => setLocForm({ ...locForm, radius_metres: e.target.value })} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <label style={{ fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={locForm.allow_remote} onChange={e => setLocForm({ ...locForm, allow_remote: e.target.checked })} />
                  Allow remote check-in from this location
                </label>
              </div>
            </div>
            <div className="admin-form-actions" style={{ marginTop: 10 }}>
              <button className="admin-save-btn" onClick={saveLoc} disabled={saving}>{saving ? 'Saving...' : editingLoc ? 'Update' : 'Add'}</button>
              <button className="admin-cancel-btn" onClick={() => setShowLocForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {locations.length === 0 ? (
          <p style={{ fontSize: 13, color: '#999', textAlign: 'center', padding: 20 }}>
            No work locations configured. Check-in will work without geofencing.
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Address</th>
                <th>Coords</th>
                <th>Radius</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map(l => (
                <tr key={l.id} style={{ opacity: l.is_active ? 1 : 0.5 }}>
                  <td>{l.name}</td>
                  <td>{l.address || '—'}</td>
                  <td style={{ fontSize: 11, fontFamily: 'monospace' }}>{l.latitude.toFixed(4)}, {l.longitude.toFixed(4)}</td>
                  <td>{l.radius_metres}m</td>
                  <td>
                    <span className={`admin-badge admin-badge-${l.is_active ? 'active' : 'inactive'}`}>
                      {l.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button className="admin-action-btn" onClick={() => openLocForm(l)}>Edit</button>
                    <button className="admin-action-btn" onClick={() => toggleLocActive(l)}>{l.is_active ? 'Disable' : 'Enable'}</button>
                    <button className="admin-action-btn admin-delete-btn" onClick={() => deleteLoc(l.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
